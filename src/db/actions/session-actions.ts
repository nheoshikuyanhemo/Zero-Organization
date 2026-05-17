"use server";

import { db } from "@/neynar-db-sdk/db";
import { sessions } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { SESSION_DURATION_DAYS, CURRENT_SESSION_ID } from "@/features/app/lib/zorg-config";

export async function getOrCreateSession() {
  const existing = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, CURRENT_SESSION_ID))
    .limit(1);

  if (existing[0]) return existing[0];

  const startedAt = new Date();
  const endsAt = new Date(startedAt);
  endsAt.setDate(endsAt.getDate() + SESSION_DURATION_DAYS);

  await db.insert(sessions).values({
    id: CURRENT_SESSION_ID,
    startedAt,
    endsAt,
    totalZpoints: 0,
    isActive: true,
    isDistributed: false,
  });

  const created = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, CURRENT_SESSION_ID))
    .limit(1);

  return created[0];
}

export async function getSessionInfo() {
  const session = await getOrCreateSession();

  const now = new Date();
  const endsAt = new Date(session.endsAt);
  const startedAt = new Date(session.startedAt);

  const elapsedMs = now.getTime() - startedAt.getTime();
  const daysElapsed = Math.min(
    SESSION_DURATION_DAYS,
    Math.floor(elapsedMs / (1000 * 60 * 60 * 24))
  );
  const daysRemaining = Math.max(0, SESSION_DURATION_DAYS - daysElapsed);
  const progressPct = Math.min(100, Math.round((daysElapsed / SESSION_DURATION_DAYS) * 100));
  const isEnded = now >= endsAt;

  return {
    session,
    daysElapsed,
    daysRemaining,
    progressPct,
    isEnded,
    endsAt,
    startedAt,
  };
}

export async function addZpointsToSession(amount: number) {
  await db
    .update(sessions)
    .set({ totalZpoints: sql`${sessions.totalZpoints} + ${amount}` })
    .where(eq(sessions.id, CURRENT_SESSION_ID));
}

/**
 * Admin only: manually end the current session immediately.
 * Sets endsAt = now and isActive = false so distribution can proceed.
 * Idempotent — safe to call multiple times.
 */
export async function endSessionNow(callerFid: number): Promise<{ success: boolean; error?: string }> {
  const creatorFid = Number(process.env.NEXT_PUBLIC_USER_FID ?? 0);
  if (callerFid !== creatorFid) return { success: false, error: "Unauthorized" };

  const session = await getOrCreateSession();
  if (session.isDistributed) return { success: false, error: "Session already distributed" };

  await db
    .update(sessions)
    .set({ endsAt: new Date(), isActive: false })
    .where(eq(sessions.id, CURRENT_SESSION_ID));

  return { success: true };
}
