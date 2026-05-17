"use server";

import { privateConfig } from "@/config/private-config";
import { publicConfig } from "@/config/public-config";

/**
 * Send a Farcaster push notification to specific FIDs, or broadcast to all
 * subscribers when target_fids is empty ([]).
 *
 * Uses Neynar frame notifications API — notifications must be enabled by the
 * user in their Farcaster client for delivery.
 */
export async function sendNotification({
  targetFids,
  title,
  body,
  uuid,
}: {
  targetFids: number[];
  title: string;
  body: string;
  uuid?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const payload: Record<string, unknown> = {
      target_fids: targetFids,
      notification: {
        title: title.slice(0, 32),
        body: body.slice(0, 128),
        target_url: publicConfig.homeUrl,
        ...(uuid ? { uuid } : {}),
      },
    };

    const res = await fetch(
      "https://api.neynar.com/v2/farcaster/frame/notifications",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": privateConfig.neynarApiKey,
        },
        body: JSON.stringify(payload),
      }
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "(unreadable)");
      console.error(`[ZORG Notify] HTTP ${res.status}: ${text}`);
      // 422 NoNotificationTokens = no users have enabled notifications yet — not a real error
      if (res.status === 422 && text.includes("NoNotificationTokens")) {
        return {
          success: false,
          error: "No subscribers yet. Users must enable notifications in Warpcast/Base first.",
        };
      }
      return { success: false, error: `HTTP ${res.status}: ${text.slice(0, 120)}` };
    }

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[ZORG Notify] Error:", msg);
    return { success: false, error: msg };
  }
}

/**
 * Broadcast the "session ended, tokens distributing" notification to all
 * ZORG subscribers. Called automatically after runDistribution completes.
 */
export async function notifySessionEnd(): Promise<{ success: boolean; error?: string }> {
  return sendNotification({
    targetFids: [], // empty = broadcast to all subscribers
    title: "ZORG Session Ended",
    body: "100 days complete. ZORG tokens are being distributed to your wallet now.",
    uuid: "zorg-session-end-s1", // idempotency key — won't send twice
  });
}

/**
 * Broadcast a custom admin announcement to all subscribers.
 */
export async function notifyCustomAnnouncement(
  title: string,
  body: string
): Promise<{ success: boolean; error?: string }> {
  return sendNotification({
    targetFids: [],
    title: title.slice(0, 32),
    body: body.slice(0, 128),
  });
}
