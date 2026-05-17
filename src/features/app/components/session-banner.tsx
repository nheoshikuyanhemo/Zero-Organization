"use client";

import { SessionInfo } from "../types";
import { USER_TOKEN_POOL } from "@/features/app/lib/zorg-config";

interface SessionBannerProps {
  session: SessionInfo | null;
  userZpoints: number;
}

export function SessionBanner({ session, userZpoints }: SessionBannerProps) {
  if (!session) return null;

  const { daysRemaining, daysElapsed, progressPct, isEnded, totalZpoints } = session;

  // User's estimated token allocation from 70% user pool only
  const estimatedTokens =
    totalZpoints > 0 && userZpoints > 0
      ? Math.floor((userZpoints / totalZpoints) * Number(USER_TOKEN_POOL))
      : 0;

  return (
    <div className="mx-4 rounded-xl border border-[#00ff41]/20 bg-[#0a0a0a] overflow-hidden">
      {/* Progress bar */}
      <div className="h-1 w-full bg-[#111]">
        <div
          className="h-full bg-[#00ff41] transition-all duration-500"
          style={{
            width: `${progressPct}%`,
            boxShadow: "0 0 8px #00ff41",
          }}
        />
      </div>

      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-[#00ff41]/50 uppercase tracking-widest">
            Session 01
          </span>
          {isEnded ? (
            <span className="font-mono text-[10px] text-red-400 uppercase tracking-widest">
              Ended — Distribution pending
            </span>
          ) : (
            <span className="font-mono text-[10px] text-[#00ff41]/50 uppercase tracking-widest">
              {daysRemaining}d remaining
            </span>
          )}
        </div>

        {/* Days progress */}
        <div className="flex items-center gap-2">
          <span
            className="font-mono text-2xl font-black text-[#00ff41]"
            style={{ textShadow: "0 0 10px #00ff41" }}
          >
            Day {daysElapsed}
          </span>
          <span className="font-mono text-sm text-[#00ff41]/30">/ 100</span>
        </div>

        {/* Token estimate */}
        {estimatedTokens > 0 && (
          <div className="flex items-center justify-between pt-1 border-t border-[#00ff41]/10">
            <span className="font-mono text-[10px] text-white/40 uppercase tracking-wider">
              Est. ZORG tokens
            </span>
            <span className="font-mono text-xs font-bold text-[#00ff41]">
              {estimatedTokens.toLocaleString()}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
