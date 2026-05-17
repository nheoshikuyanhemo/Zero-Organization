"use server";

import { db } from "@/neynar-db-sdk/db";
import { checkIns } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
export interface CheckInHistoryEntry {
  id: string;
  date: string;        // YYYY-MM-DD
  pointsEarned: number;
  streakDay: number;
  multiplier: number;
  ethFeePaid: string | null;
  txHash: string | null;
  createdAt: string;   // ISO timestamp
}

export async function getUserCheckInHistory(
  fid: number,
  limit = 100
): Promise<CheckInHistoryEntry[]> {
  const rows = await db
    .select()
    .from(checkIns)
    .where(eq(checkIns.fid, fid))
    .orderBy(desc(checkIns.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    pointsEarned: r.pointsEarned,
    streakDay: r.streakDay,
    multiplier: r.multiplier,
    ethFeePaid: r.ethFeePaid ?? null,
    txHash: r.txHash ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}
