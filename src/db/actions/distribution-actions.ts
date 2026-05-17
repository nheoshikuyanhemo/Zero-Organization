"use server";

import { db } from "@/neynar-db-sdk/db";
import { sql } from "drizzle-orm";
import { tokenDistributions, userStats, sessions } from "@/db/schema";
import { eq, and, lt } from "drizzle-orm";
import { notifySessionEnd } from "./notification-actions";
import { kvGet, kvSet } from "@/neynar-db-sdk";
import {
  TOTAL_TOKEN_SUPPLY,
  USER_TOKEN_POOL,
  DEV_TOKEN_AMOUNT,
  LIQUIDITY_TOKEN_POOL,
  DEV_WALLET_ADDRESS,
  CURRENT_SESSION_ID,
  USER_VESTING_TRANCHES,
  DEV_VESTING_DAYS,
  KV_VESTING_STARTED_AT,
  KV_USER_TRANCHE_SENT,
  KV_DEV_DAYS_CLAIMED,
} from "@/features/app/lib/zorg-config";

// Safety cap: max 15% of supply per single payout row
const MAX_SINGLE_PAYOUT = (TOTAL_TOKEN_SUPPLY * BigInt(15)) / BigInt(100);
const CREATOR_FID = Number(process.env.NEXT_PUBLIC_USER_FID ?? 0);

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Compute a user's TOTAL lifetime allocation from the 70% user pool.
 * tokenAmount = (userZpoints / totalZpoints) * USER_TOKEN_POOL
 * Pure BigInt arithmetic — no floating point.
 */
function computeUserTotalAllocation(userZpoints: number, totalZpoints: number): bigint {
  if (totalZpoints === 0 || userZpoints <= 0) return BigInt(0);
  return (BigInt(userZpoints) * USER_TOKEN_POOL) / BigInt(totalZpoints);
}

/**
 * Compute one user tranche amount = totalAllocation / USER_VESTING_TRANCHES.
 * Final (6th) tranche gets the remainder to avoid dust from integer division.
 */
function computeUserTrancheAmount(totalAllocation: bigint, tranche: number): bigint {
  const base = totalAllocation / BigInt(USER_VESTING_TRANCHES);
  if (tranche === USER_VESTING_TRANCHES) {
    // Last tranche: total minus already-sent (tranche - 1) * base
    return totalAllocation - base * BigInt(USER_VESTING_TRANCHES - 1);
  }
  return base;
}

/**
 * Compute how many full dev vesting days have elapsed since vestingStartedAt.
 */
function computeDevDaysElapsed(vestingStartedAt: Date): number {
  const msElapsed = Date.now() - vestingStartedAt.getTime();
  const daysElapsed = Math.floor(msElapsed / (1000 * 60 * 60 * 24));
  return Math.min(daysElapsed, DEV_VESTING_DAYS);
}

/**
 * Compute how many dev tokens correspond to N days of vesting.
 * Day 360 row gets the remainder to avoid dust.
 */
function computeDevTokensForDays(fromDay: number, toDay: number): bigint {
  if (fromDay >= toDay) return BigInt(0);
  const perDay = DEV_TOKEN_AMOUNT / BigInt(DEV_VESTING_DAYS);
  // Last chunk: send remainder
  if (toDay >= DEV_VESTING_DAYS) {
    const alreadySent = perDay * BigInt(fromDay);
    return DEV_TOKEN_AMOUNT - alreadySent;
  }
  return perDay * BigInt(toDay - fromDay);
}

// ── Preview helpers ───────────────────────────────────────────────────────────

/**
 * Preview: estimated token allocation for a specific user (lifetime total + per-tranche).
 */
export async function getUserTokenAllocation(
  fid: number,
  totalZpoints: number
): Promise<{ tokens: string; percentage: string; poolShare: string; perTranche: string }> {
  const user = await db
    .select({ zpoints: userStats.zpoints })
    .from(userStats)
    .where(eq(userStats.fid, fid))
    .limit(1);

  const zp = user[0]?.zpoints ?? 0;
  if (zp === 0 || totalZpoints === 0) {
    return { tokens: "0", percentage: "0.0000", poolShare: "0.0000", perTranche: "0" };
  }

  const tokens = computeUserTotalAllocation(zp, totalZpoints);
  const trancheAmt = tokens / BigInt(USER_VESTING_TRANCHES);
  const poolPct = ((zp / totalZpoints) * 100).toFixed(4);
  const totalPct = (Number(tokens) / Number(TOTAL_TOKEN_SUPPLY) * 100).toFixed(4);

  return {
    tokens: Number(tokens).toLocaleString(),
    percentage: totalPct,
    poolShare: poolPct,
    perTranche: Number(trancheAmt).toLocaleString(),
  };
}

// ── Vesting status ────────────────────────────────────────────────────────────

export interface VestingStatus {
  vestingStartedAt: string | null;       // ISO string or null if not started
  userTrancheSent: number;               // 0–6
  userTrancheNext: number;               // 1–6 or null if complete
  userVestingComplete: boolean;
  devDaysClaimed: number;                // 0–360
  devDaysElapsed: number;                // computed from vestingStartedAt
  devDaysClaimable: number;              // elapsed - claimed
  devVestingComplete: boolean;
  devTokensClaimable: string;            // human-readable
}

export async function getVestingStatus(): Promise<VestingStatus> {
  const [startedAt, trancheSentRaw, devDaysRaw] = await Promise.all([
    kvGet(KV_VESTING_STARTED_AT),
    kvGet(KV_USER_TRANCHE_SENT),
    kvGet(KV_DEV_DAYS_CLAIMED),
  ]);

  const userTrancheSent = trancheSentRaw ? parseInt(trancheSentRaw, 10) : 0;
  const devDaysClaimed = devDaysRaw ? parseInt(devDaysRaw, 10) : 0;

  let devDaysElapsed = 0;
  if (startedAt) {
    devDaysElapsed = computeDevDaysElapsed(new Date(startedAt));
  }

  const devDaysClaimable = Math.max(0, devDaysElapsed - devDaysClaimed);
  const devTokensClaimable = computeDevTokensForDays(devDaysClaimed, devDaysClaimed + devDaysClaimable);

  return {
    vestingStartedAt: startedAt,
    userTrancheSent,
    userTrancheNext: userTrancheSent < USER_VESTING_TRANCHES ? userTrancheSent + 1 : USER_VESTING_TRANCHES,
    userVestingComplete: userTrancheSent >= USER_VESTING_TRANCHES,
    devDaysClaimed,
    devDaysElapsed,
    devDaysClaimable,
    devVestingComplete: devDaysClaimed >= DEV_VESTING_DAYS,
    devTokensClaimable: Number(devTokensClaimable).toLocaleString(),
  };
}

// ── Main distribution ─────────────────────────────────────────────────────────

/**
 * Admin only: run the next distribution event.
 *
 * USER VESTING — 6 monthly tranches:
 *   Each call sends tranche N (1→6) to all users.
 *   Each tranche = 1/6 of the user's total lifetime allocation.
 *   The 6th tranche gets the remainder to avoid dust.
 *
 * DEV VESTING — 360-day linear:
 *   Each call sends all accrued-but-unclaimed dev tokens
 *   based on days elapsed since vesting started.
 *
 * LP allocation (25%): recorded as "paid" immediately when LP step is done.
 * Admin triggers each monthly run manually from the admin panel.
 */
export async function runDistribution(callerFid: number) {
  if (callerFid !== CREATOR_FID) return { error: "Unauthorized" };

  const session = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, CURRENT_SESSION_ID))
    .limit(1);

  if (!session[0]) return { error: "Session not found" };

  const tokenAddress = await kvGet("zorg:token_address");
  if (!tokenAddress) return { error: "Token not deployed yet — deploy ZORG token first" };

  // ── Determine which user tranche to run ────────────────────────────────────
  const [startedAtRaw, trancheSentRaw, devDaysRaw] = await Promise.all([
    kvGet(KV_VESTING_STARTED_AT),
    kvGet(KV_USER_TRANCHE_SENT),
    kvGet(KV_DEV_DAYS_CLAIMED),
  ]);

  const userTrancheSent = trancheSentRaw ? parseInt(trancheSentRaw, 10) : 0;
  const devDaysClaimed  = devDaysRaw     ? parseInt(devDaysRaw, 10)     : 0;
  const nextTranche     = userTrancheSent + 1;

  // If all 6 user tranches sent AND dev fully vested → nothing left
  if (userTrancheSent >= USER_VESTING_TRANCHES && devDaysClaimed >= DEV_VESTING_DAYS) {
    return { error: `All ${USER_VESTING_TRANCHES} user tranches and full dev vesting (${DEV_VESTING_DAYS} days) are complete.` };
  }

  // Record vesting start time on first distribution
  const now = new Date();
  const vestingStartedAt = startedAtRaw ? new Date(startedAtRaw) : now;
  if (!startedAtRaw) {
    await kvSet(KV_VESTING_STARTED_AT, now.toISOString());
  }

  let prepared = 0;
  let skipped   = 0;

  // ── 1. User vesting tranche N ──────────────────────────────────────────────
  if (nextTranche <= USER_VESTING_TRANCHES) {
    const allUsers    = await db.select().from(userStats);
    const totalZpoints = allUsers.reduce((s, u) => s + u.zpoints, 0);

    if (totalZpoints === 0) return { error: "No Zpoints recorded" };

    for (const user of allUsers) {
      if (user.zpoints <= 0) { skipped++; continue; }

      // Resolve verified address
      let recipientAddress: string | null = null;
      try {
        const res = await fetch(
          `https://api.neynar.com/v2/farcaster/user/bulk?fids=${user.fid}`,
          { headers: { "x-api-key": process.env.NEYNAR_API_KEY! } }
        );
        const data = await res.json();
        recipientAddress = data.users?.[0]?.verified_addresses?.primary?.eth_address ?? null;
      } catch { recipientAddress = null; }

      if (!recipientAddress) { skipped++; continue; }

      const totalAllocation = computeUserTotalAllocation(user.zpoints, totalZpoints);
      if (totalAllocation <= BigInt(0)) { skipped++; continue; }

      const trancheAmount = computeUserTrancheAmount(totalAllocation, nextTranche);
      if (trancheAmount <= BigInt(0)) { skipped++; continue; }

      if (trancheAmount > MAX_SINGLE_PAYOUT) {
        console.error(`[ZORG] Cap exceeded fid=${user.fid} tranche=${nextTranche}: ${trancheAmount}`);
        skipped++;
        continue;
      }

      // Idempotent — skip if this tranche was already inserted
      const exists = await db
        .select({ id: tokenDistributions.id })
        .from(tokenDistributions)
        .where(and(
          eq(tokenDistributions.sessionId, CURRENT_SESSION_ID),
          eq(tokenDistributions.fid, user.fid),
          eq(tokenDistributions.vestedTranche, nextTranche)
        ))
        .limit(1);

      if (!exists[0]) {
        await db.insert(tokenDistributions).values({
          sessionId: CURRENT_SESSION_ID,
          fid: user.fid,
          recipientAddress,
          zpoints: user.zpoints,
          tokenAmount: trancheAmount.toString(),
          totalAllocation: totalAllocation.toString(),
          status: "unclaimed",
          vestedTranche: nextTranche,
        });
        prepared++;
      }
    }
  }

  // ── 2. Dev vesting — send all accrued days ─────────────────────────────────
  const devDaysElapsed  = computeDevDaysElapsed(vestingStartedAt);
  const devDaysToSend   = Math.max(0, devDaysElapsed - devDaysClaimed);
  const devTokensToSend = computeDevTokensForDays(devDaysClaimed, devDaysClaimed + devDaysToSend);
  const newDevDaysClaimed = devDaysClaimed + devDaysToSend;

  if (devTokensToSend > BigInt(0) && devDaysClaimed < DEV_VESTING_DAYS) {
    // Idempotent — use day range as tranche key: store as negative sentinel -1 * newDevDaysClaimed
    const devRowSentinel = -newDevDaysClaimed; // unique per claim run
    const devExists = await db
      .select({ id: tokenDistributions.id })
      .from(tokenDistributions)
      .where(and(
        eq(tokenDistributions.sessionId, CURRENT_SESSION_ID),
        eq(tokenDistributions.fid, -1),
        eq(tokenDistributions.vestedTranche, devRowSentinel)
      ))
      .limit(1);

    if (!devExists[0]) {
      await db.insert(tokenDistributions).values({
        sessionId: CURRENT_SESSION_ID,
        fid: -1, // sentinel: dev
        recipientAddress: DEV_WALLET_ADDRESS,
        zpoints: 0,
        tokenAmount: devTokensToSend.toString(),
        totalAllocation: DEV_TOKEN_AMOUNT.toString(),
        status: "unclaimed",
        vestedTranche: devRowSentinel,
      });
      prepared++;
    }
  }

  // ── 3. LP allocation (25%) — recorded once as paid on first run ────────────
  const liqExists = await db
    .select({ id: tokenDistributions.id })
    .from(tokenDistributions)
    .where(and(
      eq(tokenDistributions.sessionId, CURRENT_SESSION_ID),
      eq(tokenDistributions.fid, -2)
    ))
    .limit(1);

  if (!liqExists[0]) {
    const lpTokenId = await kvGet("zorg:lp_token_id");
    await db.insert(tokenDistributions).values({
      sessionId: CURRENT_SESSION_ID,
      fid: -2,
      recipientAddress: "uniswap-v3-pool",
      zpoints: 0,
      tokenAmount: LIQUIDITY_TOKEN_POOL.toString(),
      totalAllocation: LIQUIDITY_TOKEN_POOL.toString(),
      status: "paid",
      txHash: lpTokenId ? `lp-nft-${lpTokenId}` : "lp-pool-direct",
      paidAt: now,
      vestedTranche: 0,
    });
    // Don't count this in prepared — it's not sent via server wallet
  }

  // ── 4. Process all unclaimed rows ─────────────────────────────────────────
  const results = await _processUnclaimed(tokenAddress);

  // ── 5. Advance vesting state KV ───────────────────────────────────────────
  if (results.failed === 0) {
    if (nextTranche <= USER_VESTING_TRANCHES) {
      await kvSet(KV_USER_TRANCHE_SENT, nextTranche.toString());
    }
    if (devTokensToSend > BigInt(0)) {
      await kvSet(KV_DEV_DAYS_CLAIMED, newDevDaysClaimed.toString());
    }

    // Mark session distributed once all 6 user tranches are done
    const finalTrancheSent = nextTranche <= USER_VESTING_TRANCHES ? nextTranche : userTrancheSent;
    if (finalTrancheSent >= USER_VESTING_TRANCHES && newDevDaysClaimed >= DEV_VESTING_DAYS) {
      await db
        .update(sessions)
        .set({ isActive: false, isDistributed: true, distributedAt: new Date() })
        .where(eq(sessions.id, CURRENT_SESSION_ID));

      notifySessionEnd().catch((err) =>
        console.error("[ZORG] Post-distribution notification failed:", err)
      );
    }
  }

  return {
    success: true,
    prepared,
    skipped,
    sent: results.sent,
    failed: results.failed,
    errors: results.errors,
    tranche: nextTranche <= USER_VESTING_TRANCHES ? nextTranche : null,
    devDaysSent: devDaysToSend,
  };
}

// ── Send unclaimed rows via server wallet / bank ──────────────────────────────

async function _processUnclaimed(tokenAddress: string) {
  const pending = await db
    .select()
    .from(tokenDistributions)
    .where(and(
      eq(tokenDistributions.sessionId, CURRENT_SESSION_ID),
      eq(tokenDistributions.status, "unclaimed")
    ));

  const results = { sent: 0, failed: 0, errors: [] as string[] };

  for (const record of pending) {
    // Atomic claim guard
    const claimed = await db
      .update(tokenDistributions)
      .set({ status: "pending", claimStartedAt: new Date() })
      .where(and(
        eq(tokenDistributions.id, record.id),
        eq(tokenDistributions.status, "unclaimed")
      ))
      .returning();

    if (!claimed.length) continue;

    try {
      const tokenAmount = BigInt(record.tokenAmount);
      if (tokenAmount <= BigInt(0) || tokenAmount > MAX_SINGLE_PAYOUT) {
        throw new Error(`Invalid amount: ${record.tokenAmount}`);
      }

      const bankAddress  = await kvGet("zorg:bank_address");
      const isBankFunded = await kvGet("zorg:bank_funded");

      let response: Response;

      if (bankAddress && isBankFunded) {
        // Bank path: ZorgBank.sendTokens via Neynar server wallet (operator)
        response = await fetch(
          "https://api.neynar.com/v2/farcaster/contract/call",
          {
            method: "POST",
            headers: {
              "x-api-key": process.env.NEYNAR_API_KEY!,
              "x-wallet-id": process.env.NEYNAR_WALLET_ID!,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              contract_address: bankAddress,
              network: "base",
              function_signature: "sendTokens(address,address,uint256)",
              args: [tokenAddress, record.recipientAddress, record.tokenAmount],
            }),
          }
        );
      } else {
        // Legacy: direct transfer from Neynar server wallet
        response = await fetch(
          "https://api.neynar.com/v2/farcaster/fungible/send",
          {
            method: "POST",
            headers: {
              "x-api-key": process.env.NEYNAR_API_KEY!,
              "x-wallet-id": process.env.NEYNAR_WALLET_ID!,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              recipients: [{ address: record.recipientAddress, amount: record.tokenAmount }],
              token_address: tokenAddress,
              network: "base",
            }),
          }
        );
      }

      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Transfer failed");

      const txHash = result.transaction_hash ?? result.txHash ?? "confirmed";
      await db
        .update(tokenDistributions)
        .set({ status: "paid", txHash, paidAt: new Date() })
        .where(eq(tokenDistributions.id, record.id));

      results.sent++;
    } catch (error) {
      const safeReason = error instanceof Error
        ? error.message.slice(0, 200)
        : "Unknown error";

      await db
        .update(tokenDistributions)
        .set({ status: "failed", failureReason: safeReason })
        .where(eq(tokenDistributions.id, record.id));

      results.failed++;
      results.errors.push(`fid=${record.fid}: ${safeReason}`);
    }
  }

  return results;
}

// ── Retry ─────────────────────────────────────────────────────────────────────

/**
 * Retry failed rows (up to 3 retries each).
 * Does NOT advance the tranche counter — only retries existing failed rows.
 */
export async function retryFailedDistributions(callerFid: number) {
  if (callerFid !== CREATOR_FID) return { error: "Unauthorized" };

  const tokenAddress = await kvGet("zorg:token_address");
  if (!tokenAddress) return { error: "Token not deployed yet" };

  await db
    .update(tokenDistributions)
    .set({ status: "unclaimed" })
    .where(and(
      eq(tokenDistributions.status, "failed"),
      lt(tokenDistributions.retryCount, 3)
    ));

  return _processUnclaimed(tokenAddress);
}

// ── Stats ─────────────────────────────────────────────────────────────────────

/**
 * Get distribution summary stats across all tranches.
 */
export async function getDistributionStats() {
  const all = await db
    .select()
    .from(tokenDistributions)
    .where(eq(tokenDistributions.sessionId, CURRENT_SESSION_ID));

  // Exclude LP row (fid=-2) from sent/failed counts — it's always "paid"
  const userAndDev = all.filter(r => r.fid !== -2);

  return {
    total: userAndDev.length,
    unclaimed: userAndDev.filter(r => r.status === "unclaimed").length,
    pending:   userAndDev.filter(r => r.status === "pending").length,
    paid:      userAndDev.filter(r => r.status === "paid").length,
    failed:    userAndDev.filter(r => r.status === "failed").length,
  };
}
