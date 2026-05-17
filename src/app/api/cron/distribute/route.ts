/**
 * Auto-distribution cron — fires on Day 101
 * Protect with CRON_SECRET to prevent unauthorized triggers.
 *
 * Schedule this URL to be called once daily:
 *   GET /api/cron/distribute
 *   Header: Authorization: Bearer <CRON_SECRET>
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionInfo } from "@/db/actions/session-actions";
import { runDistribution } from "@/db/actions/distribution-actions";
import { DISTRIBUTION_TRIGGER_DAY } from "@/features/app/lib/zorg-config";

export async function GET(req: NextRequest) {
  // Verify cron secret (constant-time safe via timing-safe comparison)
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace("Bearer ", "").trim();
  const cronSecret = process.env.CRON_SECRET ?? "";

  if (!cronSecret || !timingSafeEqual(token, cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check if we're on Day 101+
  const session = await getSessionInfo();
  if (!session.isEnded) {
    return NextResponse.json({
      skipped: true,
      reason: `Session still active — ${session.daysRemaining} days remaining`,
    });
  }

  if (session.daysElapsed < DISTRIBUTION_TRIGGER_DAY - 1) {
    return NextResponse.json({
      skipped: true,
      reason: `Day ${session.daysElapsed + 1} — distribution triggers on Day ${DISTRIBUTION_TRIGGER_DAY}`,
    });
  }

  const creatorFid = Number(process.env.NEXT_PUBLIC_USER_FID ?? 0);
  const result = await runDistribution(creatorFid);

  return NextResponse.json(result);
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
