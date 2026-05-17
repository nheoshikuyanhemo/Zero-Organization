"use server";

import { db } from "@/neynar-db-sdk/db";
import { tapGame, tapHistory, userStats } from "@/db/schema";
import { eq, sql, and } from "drizzle-orm";
import {
  FREE_TAPS_PER_CHARGE,
  PAID_TAPS_PER_CHARGE,
  FREE_TAP_UNITS,
  PAID_TAP_UNITS,
  UNITS_PER_ZP,
} from "@/features/app/lib/tap-config";

function getTodayDateString(): string {
  return new Date().toISOString().split("T")[0];
}

async function getOrCreateTapGame(fid: number) {
  const existing = await db.select().from(tapGame).where(eq(tapGame.fid, fid)).limit(1);
  if (existing[0]) return existing[0];
  await db.insert(tapGame).values({
    fid,
    tapZpUnits: 0,
    tapZpCredited: 0,
    freeEnergyUsed: 0,
    paidEnergyCharges: 0,
    paidEnergyUsed: 0,
  });
  const created = await db.select().from(tapGame).where(eq(tapGame.fid, fid)).limit(1);
  return created[0]!;
}

export async function getTapGameState(fid: number): Promise<{
  freeEnergyUsed: number;
  freeEnergyMax: number;
  paidEnergyCharges: number;
  paidEnergyUsed: number;
  paidEnergyMax: number;
  tapZpUnits: number;
  tapZpCredited: number;
  lastFreeReset: string | null;
}> {
  const state = await getOrCreateTapGame(fid);
  const today = getTodayDateString();

  let freeEnergyUsed = state.freeEnergyUsed;
  if (state.lastFreeReset !== today) {
    // Daily reset — free energy refills
    freeEnergyUsed = 0;
    await db.update(tapGame)
      .set({ freeEnergyUsed: 0, lastFreeReset: today, updatedAt: new Date() })
      .where(eq(tapGame.fid, fid));
  }

  return {
    freeEnergyUsed,
    freeEnergyMax: FREE_TAPS_PER_CHARGE,
    paidEnergyCharges: state.paidEnergyCharges,
    paidEnergyUsed: state.paidEnergyUsed,
    paidEnergyMax: state.paidEnergyCharges * PAID_TAPS_PER_CHARGE,
    tapZpUnits: state.tapZpUnits,
    tapZpCredited: state.tapZpCredited,
    lastFreeReset: state.lastFreeReset,
  };
}

/**
 * Record a batch of taps from the client (~800ms flush interval).
 *
 * ZP scaling:
 *   free tap  → +1 unit   (0.0001 ZP each, max 10 ZP / 100k free taps)
 *   paid tap  → +1000 units (0.1 ZP each, max 500 ZP / 5k paid taps)
 *
 * Integer ZP is credited to userStats.zpoints once accumulated units cross the
 * next whole-ZP threshold (every UNITS_PER_ZP = 10,000 units = 1 ZP).
 */
export async function recordTaps(fid: number, tapCount: number, usePaid: boolean): Promise<{
  success: boolean;
  actualTaps: number;
  newTapZpUnits: number;   // accumulated ZP units (×10000) — for display math
  zpCredited: number;      // whole ZP added to userStats.zpoints this batch
  error?: string;
}> {
  if (tapCount <= 0 || tapCount > 500) {
    return { success: false, actualTaps: 0, newTapZpUnits: 0, zpCredited: 0, error: "Invalid tap count" };
  }

  const state = await getOrCreateTapGame(fid);
  const today = getTodayDateString();
  const freeEnergyUsed = state.lastFreeReset !== today ? 0 : state.freeEnergyUsed;

  let actualTaps: number;
  let unitsEarned: number;

  if (usePaid) {
    const paidAvailable = state.paidEnergyCharges * PAID_TAPS_PER_CHARGE - state.paidEnergyUsed;
    if (paidAvailable <= 0) {
      return { success: false, actualTaps: 0, newTapZpUnits: state.tapZpUnits, zpCredited: 0, error: "No paid energy remaining" };
    }
    actualTaps = Math.min(tapCount, paidAvailable);
    unitsEarned = actualTaps * PAID_TAP_UNITS; // 1000 units per paid tap (0.1 ZP each)
  } else {
    const freeAvailable = FREE_TAPS_PER_CHARGE - freeEnergyUsed;
    if (freeAvailable <= 0) {
      return { success: false, actualTaps: 0, newTapZpUnits: state.tapZpUnits, zpCredited: 0, error: "Free energy depleted" };
    }
    actualTaps = Math.min(tapCount, freeAvailable);
    unitsEarned = actualTaps * FREE_TAP_UNITS; // 1 unit per free tap (0.0001 ZP each)
  }

  const oldZpUnits = state.tapZpUnits;
  const newZpUnits = oldZpUnits + unitsEarned;

  // Whole ZP to credit = new floor - old floor (in whole ZP units)
  const zpCredited = Math.floor(newZpUnits / UNITS_PER_ZP) - Math.floor(oldZpUnits / UNITS_PER_ZP);
  const newZpCredited = state.tapZpCredited + zpCredited;

  if (usePaid) {
    await db.update(tapGame).set({
      tapZpUnits: newZpUnits,
      tapZpCredited: newZpCredited,
      paidEnergyUsed: state.paidEnergyUsed + actualTaps,
      updatedAt: new Date(),
    }).where(eq(tapGame.fid, fid));
  } else {
    await db.update(tapGame).set({
      tapZpUnits: newZpUnits,
      tapZpCredited: newZpCredited,
      freeEnergyUsed: freeEnergyUsed + actualTaps,
      lastFreeReset: today,
      updatedAt: new Date(),
    }).where(eq(tapGame.fid, fid));
  }

  // Credit whole ZP to main balance
  if (zpCredited > 0) {
    await db.update(userStats)
      .set({ zpoints: sql`zpoints + ${zpCredited}`, updatedAt: new Date() })
      .where(eq(userStats.fid, fid));
  }

  // Upsert daily tap history row — accumulate units earned today
  const existingDay = await db
    .select()
    .from(tapHistory)
    .where(and(eq(tapHistory.fid, fid), eq(tapHistory.date, today)))
    .limit(1);

  if (existingDay[0]) {
    await db.update(tapHistory)
      .set({
        tapZpUnits: existingDay[0].tapZpUnits + unitsEarned,
        updatedAt: new Date(),
      })
      .where(and(eq(tapHistory.fid, fid), eq(tapHistory.date, today)));
  } else {
    await db.insert(tapHistory).values({
      fid,
      date: today,
      tapZpUnits: unitsEarned,
    });
  }

  return { success: true, actualTaps, newTapZpUnits: newZpUnits, zpCredited };
}

/**
 * Get per-day tap ZP history for a user, most recent first.
 * Returns date + tapZpUnits (×10000) for each day they tapped.
 */
export async function getTapHistory(fid: number, limit = 90): Promise<Array<{
  date: string;
  tapZpUnits: number;
}>> {
  const { desc: descOrder } = await import("drizzle-orm");
  const rows = await db
    .select({ date: tapHistory.date, tapZpUnits: tapHistory.tapZpUnits })
    .from(tapHistory)
    .where(eq(tapHistory.fid, fid))
    .orderBy(descOrder(tapHistory.date))
    .limit(limit);
  return rows;
}

/**
 * Tap leaderboard — top users ranked by total lifetime tap ZP units earned.
 * Joins tap_game with user_stats to get display info.
 * Returns up to `limit` users sorted by tapZpUnits desc.
 */
export async function getTapLeaderboard(limit = 20): Promise<Array<{
  fid: number;
  username: string;
  displayName: string;
  pfpUrl: string | null | undefined;
  tapZpUnits: number;
  tapZpCredited: number;
  zpoints: number;
}>> {
  const { userStats } = await import("@/db/schema");
  const { desc: descOrder } = await import("drizzle-orm");
  const rows = await db
    .select({
      fid: tapGame.fid,
      tapZpUnits: tapGame.tapZpUnits,
      tapZpCredited: tapGame.tapZpCredited,
      username: userStats.username,
      displayName: userStats.displayName,
      pfpUrl: userStats.pfpUrl,
      zpoints: userStats.zpoints,
    })
    .from(tapGame)
    .innerJoin(userStats, eq(userStats.fid, tapGame.fid))
    .orderBy(descOrder(tapGame.tapZpUnits))
    .limit(limit);
  return rows;
}

/**
 * Compute tap achievements for a user from their tap_game state.
 * Returns all achievement definitions with unlocked/progress fields populated.
 */
export async function getTapAchievements(fid: number) {
  const { computeTapAchievements } = await import("@/features/app/lib/tap-achievements");
  const state = await getOrCreateTapGame(fid);
  const today = getTodayDateString();
  const freeEnergyUsed = state.lastFreeReset !== today ? 0 : state.freeEnergyUsed;

  return computeTapAchievements({
    tapZpUnits: state.tapZpUnits,
    tapZpCredited: state.tapZpCredited,
    paidEnergyCharges: state.paidEnergyCharges,
    paidEnergyUsed: state.paidEnergyUsed,
    freeEnergyUsed,
  });
}

/**
 * Activate paid energy after on-chain tx confirmed.
 * txHash is the idempotency key — prevents double-activation of the same tx.
 */
export async function activatePaidEnergy(fid: number, txHash: string): Promise<{
  success: boolean;
  error?: string;
}> {
  if (!txHash || txHash.length < 10) {
    return { success: false, error: "Invalid transaction hash" };
  }
  const state = await getOrCreateTapGame(fid);
  if (state.lastPaidTxHash === txHash) {
    return { success: false, error: "Transaction already used" };
  }
  await db.update(tapGame).set({
    paidEnergyCharges: state.paidEnergyCharges + 1,
    lastPaidTxHash: txHash,
    updatedAt: new Date(),
  }).where(eq(tapGame.fid, fid));
  return { success: true };
}
