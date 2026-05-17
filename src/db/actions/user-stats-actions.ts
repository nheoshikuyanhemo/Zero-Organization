"use server";

import { db } from "@/neynar-db-sdk/db";
import { userStats, checkIns, feeLogs } from "@/db/schema";
import { eq, desc, sum, sql } from "drizzle-orm";
import { kvGet, kvSet } from "@/neynar-db-sdk";

const WELCOME_BONUS_ZP = 10;
// KV key that marks the backfill as done — only runs once ever
const BACKFILL_DONE_KEY = "zorg:welcome_bonus_backfill_v1";
import { addZpointsToSession } from "./session-actions";
import { creditReferralBonus, registerReferral } from "./referral-actions";
import {
  FEE_BPS,
  TOTAL_BPS,
  CURRENT_SESSION_ID,
  getStreakMultiplier,
} from "@/features/app/lib/zorg-config";

function getTodayDateString(): string {
  return new Date().toISOString().split("T")[0];
}

function getYesterdayDateString(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}

export async function getUserStats(fid: number) {
  const result = await db
    .select()
    .from(userStats)
    .where(eq(userStats.fid, fid))
    .limit(1);
  return result[0] ?? null;
}

export async function getOrCreateUserStats(
  fid: number,
  username: string,
  displayName: string,
  pfpUrl?: string,
  referralCode?: string   // optional: referral code from URL param on first join
) {
  const existing = await getUserStats(fid);
  if (existing) {
    // Always keep display info fresh
    if (
      existing.username !== username ||
      existing.displayName !== displayName ||
      existing.pfpUrl !== pfpUrl
    ) {
      await db
        .update(userStats)
        .set({ username, displayName, pfpUrl, updatedAt: new Date() })
        .where(eq(userStats.fid, fid));
    }
    return { ...existing, username, displayName, pfpUrl };
  }

  // Brand new user — create their stats with 10 ZP welcome bonus
  await db.insert(userStats).values({
    fid,
    username,
    displayName,
    pfpUrl,
    zpoints: WELCOME_BONUS_ZP,
    currentStreak: 0,
    longestStreak: 0,
    totalCheckIns: 0,
    lastCheckIn: null,
    streakMultiplier: 1,
  });
  // Mark welcome bonus as awarded so backfill skips this user
  await kvSet(`zorg:wb:${fid}`, "1").catch(() => {});

  // Register referral if a valid code was provided
  if (referralCode) {
    // refCodeToFid: base36 FID code → number
    const referrerFid = parseInt(referralCode.toLowerCase(), 36);
    if (!isNaN(referrerFid) && referrerFid > 0 && referrerFid !== fid) {
      await registerReferral(fid, referrerFid).catch(() => {
        // Non-fatal — don't block account creation on referral errors
      });
    }
  }

  const created = await getUserStats(fid);
  return created!;
}

// ─── Check-in points rules ─────────────────────────────────────────────────
// Onchain: base 100 ZP + 1 ZP per streak day (no multiplier multiplier, streak IS the bonus)
//          e.g. streak 1 = 101 ZP, streak 5 = 105 ZP, streak 30 = 130 ZP
// Free:    base 1 ZP + 0.1 ZP per streak day (stored ×10 as integer to avoid floats)
//          e.g. streak 1 = 1.1 ZP (stored as 11), streak 5 = 1.5 ZP (stored as 15)
//          displayed by dividing by 10 in the UI
// Both modes advance the streak counter.
// If already did FREE today, can still do ONCHAIN — onchain awards delta points on top.
// If already did ONCHAIN today, cannot do free (onchain is always better).

export async function performCheckIn(
  fid: number,
  username: string,
  displayName: string,
  pfpUrl?: string,
  txHash?: string,        // required for onchain, undefined for free
  ethFeePaid?: string,
  sessionDay?: number,
  freeMode?: boolean
): Promise<{
  success: boolean;
  alreadyCheckedIn: boolean;  // true only if onchain was already done today
  alreadyFreeCheckedIn: boolean;
  pointsEarned: number;
  newTotal: number;
  newStreak: number;
  multiplier: number;
  message: string;
  feeZpoints: number;
  freeMode: boolean;
}> {
  const stats = await getOrCreateUserStats(fid, username, displayName, pfpUrl);
  const today = getTodayDateString();
  const yesterday = getYesterdayDateString();

  // Check today's check-in records
  const todayRecords = await db
    .select({ txHash: checkIns.txHash, pointsEarned: checkIns.pointsEarned })
    .from(checkIns)
    .where(eq(checkIns.fid, fid))
    .orderBy(desc(checkIns.createdAt))
    .limit(5);

  const todayOnchain = todayRecords.find(r => r.txHash !== null && stats.lastCheckIn === today);
  const todayFree = todayRecords.find(r => r.txHash === null && stats.lastCheckIn === today);

  // Onchain: blocked if already did onchain today
  if (!freeMode && todayOnchain) {
    return {
      success: false,
      alreadyCheckedIn: true,
      alreadyFreeCheckedIn: !!todayFree,
      pointsEarned: 0,
      newTotal: stats.zpoints,
      newStreak: stats.currentStreak,
      multiplier: stats.streakMultiplier,
      message: "Already checked in onchain today. Come back tomorrow!",
      feeZpoints: 0,
      freeMode: false,
    };
  }

  // Free: blocked only if already did free today (onchain does NOT block free)
  if (freeMode && todayFree) {
    return {
      success: false,
      alreadyCheckedIn: !!todayOnchain,
      alreadyFreeCheckedIn: true,
      pointsEarned: 0,
      newTotal: stats.zpoints,
      newStreak: stats.currentStreak,
      multiplier: stats.streakMultiplier,
      message: "Already did free check-in today.",
      feeZpoints: 0,
      freeMode: true,
    };
  }

  // Calculate streak (only counts when it's the first check-in of the day)
  let newStreak: number;
  const isFirstCheckInToday = stats.lastCheckIn !== today;
  if (isFirstCheckInToday) {
    newStreak = stats.lastCheckIn === yesterday ? stats.currentStreak + 1 : 1;
  } else {
    newStreak = stats.currentStreak; // streak already updated by earlier check-in today
  }

  const multiplier = getStreakMultiplier(newStreak);

  // Points calculation
  // Onchain: 100 + streak ZP (streak bonus = +1 ZP per streak day)
  // Free: (1 + streak×0.1) ZP stored ×10 as integer → divide by 10 in UI
  let pointsEarned: number;
  let feeZpoints: number;

  if (freeMode) {
    // Free check-in: 1 ZP base + 0.1 ZP per streak day
    // Stored as real integer ZP — fractional part rounds up every 10 streak days
    // streak 0 → 1 ZP, streak 1-9 → 1 ZP, streak 10-19 → 2 ZP, streak 20-29 → 3 ZP
    pointsEarned = 1 + Math.floor(newStreak / 10);
    feeZpoints = 0;
  } else {
    // Onchain: 100 base + 1 per streak day
    const onchainGross = 100 + newStreak;
    // If free was done today, award delta only (prevents double-counting)
    // Use real ZP values for the delta (free already credited real ZP)
    const freeAlreadyEarned = todayFree ? todayFree.pointsEarned : 0;
    const grossPoints = Math.max(0, onchainGross - freeAlreadyEarned);
    feeZpoints = Math.floor((grossPoints * FEE_BPS) / TOTAL_BPS);
    pointsEarned = grossPoints - feeZpoints;
  }

  const newTotal = stats.zpoints + pointsEarned;
  const newLongestStreak = Math.max(stats.longestStreak, newStreak);

  await db.transaction(async (tx) => {
    await tx
      .update(userStats)
      .set({
        zpoints: newTotal,
        currentStreak: newStreak,
        longestStreak: newLongestStreak,
        totalCheckIns: isFirstCheckInToday ? stats.totalCheckIns + 1 : stats.totalCheckIns,
        lastCheckIn: today,
        streakMultiplier: multiplier,
        updatedAt: new Date(),
      })
      .where(eq(userStats.fid, fid));

    await tx.insert(checkIns).values({
      fid,
      date: today,
      pointsEarned,
      streakDay: newStreak,
      multiplier,
      sessionId: CURRENT_SESSION_ID,
      ethFeePaid: freeMode ? "0" : (ethFeePaid ?? "0.00005"),
      txHash: freeMode ? null : (txHash ?? null),
    });

    if (feeZpoints > 0) {
      await tx.insert(feeLogs).values({
        fid,
        sessionId: CURRENT_SESSION_ID,
        zpoints: pointsEarned,
        feeZpoints,
      });
    }
  });

  await addZpointsToSession(pointsEarned);

  // If this is an onchain check-in, credit 25% bonus to referrer (if any)
  // Referrer bonus does NOT reduce pointsEarned for the referee
  if (!freeMode && pointsEarned > 0) {
    await creditReferralBonus(fid, pointsEarned).catch(() => {
      // Non-fatal — don't block check-in on referral errors
    });
  }

  return {
    success: true,
    alreadyCheckedIn: false,
    alreadyFreeCheckedIn: !!todayFree,
    pointsEarned,
    newTotal,
    newStreak,
    multiplier,
    message: freeMode
      ? `Free check-in. +${1 + Math.floor(newStreak / 10)} ZP. Do onchain for ${100 + newStreak} ZP today.`
      : getCheckInMessage(newStreak, multiplier),
    feeZpoints,
    freeMode: freeMode ?? false,
  };
}

function getCheckInMessage(streak: number, multiplier: number): string {
  if (streak === 1) return "Welcome to ZORG. Your journey begins.";
  if (streak === 3) return "3-day streak. The system notices you.";
  if (streak === 7) return "7 days. You are becoming part of the machine.";
  if (streak === 14) return "14 days. Loyalty recorded on-chain.";
  if (streak === 30) return "30 days. ZORG has accepted you.";
  if (multiplier >= 5) return `${streak} days. Maximum power. ${multiplier}x points.`;
  if (multiplier >= 3) return `${streak}-day streak. ${multiplier}x multiplier active.`;
  return `${streak}-day streak. Keep going.`;
}

/**
 * Check today's check-in status for a user — used to seed UI state on load.
 * Returns which modes have already been used today.
 */
export async function getTodayCheckInStatus(fid: number): Promise<{
  onchainDone: boolean;
  freeDone: boolean;
}> {
  const today = getTodayDateString();
  const rows = await db
    .select({ txHash: checkIns.txHash, date: checkIns.date })
    .from(checkIns)
    .where(eq(checkIns.fid, fid))
    .orderBy(desc(checkIns.createdAt))
    .limit(10);

  const todayRows = rows.filter(r => r.date === today);
  return {
    onchainDone: todayRows.some(r => r.txHash !== null),
    freeDone: todayRows.some(r => r.txHash === null),
  };
}

export async function getLeaderboard(limit = 20) {
  return db
    .select()
    .from(userStats)
    .orderBy(desc(userStats.zpoints))
    .limit(limit);
}

/**
 * Leaderboard enriched with each user's carry-over tap ZP units (×10000).
 * The display total = zpoints + tapZpUnits/10000 so fractional tap amounts
 * show up immediately without waiting for a whole-ZP threshold.
 * Sort is still by settled integer zpoints (stable DB ordering).
 */
export async function getLeaderboardWithTapZp(limit = 20): Promise<Array<{
  fid: number;
  username: string;
  displayName: string;
  pfpUrl: string | null | undefined;
  zpoints: number;
  currentStreak: number;
  longestStreak: number;
  totalCheckIns: number;
  tapZpUnits: number;
}>> {
  const { tapGame } = await import("@/db/schema");
  const rows = await db
    .select({
      fid: userStats.fid,
      username: userStats.username,
      displayName: userStats.displayName,
      pfpUrl: userStats.pfpUrl,
      zpoints: userStats.zpoints,
      currentStreak: userStats.currentStreak,
      longestStreak: userStats.longestStreak,
      totalCheckIns: userStats.totalCheckIns,
      tapZpUnits: tapGame.tapZpUnits,
    })
    .from(userStats)
    .leftJoin(tapGame, eq(tapGame.fid, userStats.fid))
    .orderBy(desc(userStats.zpoints))
    .limit(limit);

  return rows.map(r => ({
    ...r,
    tapZpUnits: r.tapZpUnits ?? 0,
  }));
}

export async function getGlobalTotalZpoints(): Promise<number> {
  const result = await db
    .select({ total: sum(userStats.zpoints) })
    .from(userStats);
  return Number(result[0]?.total ?? 0);
}

export async function getTotalFeesCollected(): Promise<number> {
  const result = await db
    .select({ total: sum(feeLogs.feeZpoints) })
    .from(feeLogs);
  return Number(result[0]?.total ?? 0);
}

/**
 * Sum all ETH fees paid across all check-ins.
 * ethFeePaid is stored as a decimal string e.g. "0.0001" — we sum and return as a number.
 */
export async function getUserCheckInHistory(fid: number, limit = 90) {
  return db
    .select()
    .from(checkIns)
    .where(eq(checkIns.fid, fid))
    .orderBy(desc(checkIns.createdAt))
    .limit(limit);
}

/**
 * One-time backfill: award 10 ZP welcome bonus to every existing user
 * who joined before this feature was added.
 *
 * Safe to call on every app load — the BACKFILL_DONE_KEY KV flag ensures
 * it only runs once. Idempotent per-user via zorg:wb:{fid} markers.
 */
export async function runWelcomeBonusBackfill(): Promise<{
  awarded: number;
  skipped: number;
  alreadyDone: boolean;
}> {
  // Fast exit — backfill already completed
  const done = await kvGet(BACKFILL_DONE_KEY);
  if (done) return { awarded: 0, skipped: 0, alreadyDone: true };

  const allUsers = await db.select({ fid: userStats.fid }).from(userStats);
  let awarded = 0;
  let skipped = 0;

  for (const { fid } of allUsers) {
    const hasBonus = await kvGet(`zorg:wb:${fid}`);
    if (hasBonus) { skipped++; continue; }

    // Award +10 ZP and mark as done
    await db
      .update(userStats)
      .set({ zpoints: sql`zpoints + ${WELCOME_BONUS_ZP}`, updatedAt: new Date() })
      .where(eq(userStats.fid, fid));
    await kvSet(`zorg:wb:${fid}`, "1").catch(() => {});
    awarded++;
  }

  // Mark the whole backfill as done so this never runs again
  await kvSet(BACKFILL_DONE_KEY, new Date().toISOString());
  return { awarded, skipped, alreadyDone: false };
}

export async function getTotalEthCollected(): Promise<number> {
  const rows = await db
    .select({ ethFeePaid: checkIns.ethFeePaid })
    .from(checkIns)
    .where(sql`${checkIns.ethFeePaid} IS NOT NULL`);

  const total = rows.reduce((acc, r) => acc + parseFloat(r.ethFeePaid ?? "0"), 0);
  return total;
}
