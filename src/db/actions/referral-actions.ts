"use server";

import { db } from "@/neynar-db-sdk/db";
import { referrals, userStats } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { fidToRefCode } from "@/features/app/lib/referral-utils";

// ─── Get referral status for a user ──────────────────────────────────────────
export async function getReferralStats(fid: number): Promise<{
  referralCode: string;
  totalReferrals: number;
  totalBonusEarned: number;
  myReferrerUsername: string | null;
}> {
  // Count how many people this user has referred
  const referredRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(referrals)
    .where(eq(referrals.referrerFid, fid));

  const totalReferrals = Number(referredRows[0]?.count ?? 0);

  // Sum all bonus ZP earned from referee activity
  const bonusRows = await db
    .select({ total: sql<number>`coalesce(sum(total_bonus_earned), 0)` })
    .from(referrals)
    .where(eq(referrals.referrerFid, fid));

  const totalBonusEarned = Number(bonusRows[0]?.total ?? 0);

  // Who referred this user? Look up their username from userStats
  const myReferralRow = await db
    .select({ referrerFid: referrals.referrerFid })
    .from(referrals)
    .where(eq(referrals.refereeFid, fid))
    .limit(1);

  let myReferrerUsername: string | null = null;
  if (myReferralRow[0]) {
    const referrerStats = await db
      .select({ username: userStats.username })
      .from(userStats)
      .where(eq(userStats.fid, myReferralRow[0].referrerFid))
      .limit(1);
    myReferrerUsername = referrerStats[0]?.username ?? `fid:${myReferralRow[0].referrerFid}`;
  }

  return {
    referralCode: fidToRefCode(fid),
    totalReferrals,
    totalBonusEarned,
    myReferrerUsername,
  };
}

// ─── Register a referral when a new user joins via referral code ──────────────
// Called during getOrCreateUserStats on first signup
export async function registerReferral(
  refereeFid: number,
  referrerFid: number
): Promise<{ success: boolean; alreadyReferred: boolean }> {
  // Can't refer yourself
  if (refereeFid === referrerFid) {
    return { success: false, alreadyReferred: false };
  }

  // Check if referee already has a referrer (one referrer per user, first-write-wins)
  const existing = await db
    .select({ id: referrals.id })
    .from(referrals)
    .where(eq(referrals.refereeFid, refereeFid))
    .limit(1);

  if (existing.length > 0) {
    return { success: false, alreadyReferred: true };
  }

  // Create referral record
  await db.insert(referrals).values({
    referrerFid,
    refereeFid,
    joinBonusPaid: false,
    totalBonusEarned: 0,
  });

  // Award 10 ZP join bonus to the referrer
  await db
    .update(userStats)
    .set({
      zpoints: sql`zpoints + 10`,
      updatedAt: new Date(),
    })
    .where(eq(userStats.fid, referrerFid));

  // Mark join bonus as paid
  await db
    .update(referrals)
    .set({ joinBonusPaid: true, updatedAt: new Date() })
    .where(and(eq(referrals.referrerFid, referrerFid), eq(referrals.refereeFid, refereeFid)));

  return { success: true, alreadyReferred: false };
}

// ─── Award 25% bonus to referrer when referee does onchain check-in ──────────
// pointsEarned = referee's gross onchain check-in points
// Returns the bonus ZP added to referrer (0 if no referrer)
export async function creditReferralBonus(
  refereeFid: number,
  pointsEarned: number
): Promise<number> {
  if (pointsEarned <= 0) return 0;

  // Find this user's referrer
  const referralRow = await db
    .select({ referrerFid: referrals.referrerFid, id: referrals.id })
    .from(referrals)
    .where(eq(referrals.refereeFid, refereeFid))
    .limit(1);

  if (!referralRow[0]) return 0;

  const { referrerFid, id } = referralRow[0];
  const bonusZp = Math.floor(pointsEarned * 0.25); // 25%, floor to integer

  if (bonusZp <= 0) return 0;

  // Credit referrer (does NOT reduce referee's points — referee keeps 100%)
  await db
    .update(userStats)
    .set({
      zpoints: sql`zpoints + ${bonusZp}`,
      updatedAt: new Date(),
    })
    .where(eq(userStats.fid, referrerFid));

  // Track cumulative bonus in referral record
  await db
    .update(referrals)
    .set({
      totalBonusEarned: sql`total_bonus_earned + ${bonusZp}`,
      updatedAt: new Date(),
    })
    .where(eq(referrals.id, id));

  return bonusZp;
}
