"use client";

import { UserStats } from "../types";
import { UserAvatar } from "@/neynar-farcaster-sdk/mini";

const UNITS_PER_ZP = 10_000;

interface ZorgHeaderProps {
  stats: UserStats | null;
  tapZpUnits?: number;
}

export function ZorgHeader({ stats, tapZpUnits = 0 }: ZorgHeaderProps) {
  // Combine settled integer ZP with live fractional tap ZP
  const totalZp = stats ? stats.zpoints + tapZpUnits / UNITS_PER_ZP : 0;
  const zpDisplay = tapZpUnits > 0
    ? totalZp.toFixed(4)
    : stats?.zpoints.toLocaleString() ?? "0";

  return (
    <div className="flex items-center justify-between px-4 pt-4 pb-2">
      <span
        className="font-mono font-black text-xl tracking-widest text-[#00ff41]"
        style={{ textShadow: "0 0 8px #00ff41" }}
      >
        ZORG
      </span>
      {stats && (
        <div className="flex items-center gap-2">
          <div className="text-right">
            <p className="font-mono text-xs text-[#00ff41]/60">
              @{stats.username}
            </p>
            <p className="font-mono text-xs font-bold text-[#00ff41]">
              {zpDisplay} ZP
            </p>
          </div>
          {stats.pfpUrl && (
            <div className="relative">
              <UserAvatar
                user={{ pfp_url: stats.pfpUrl ?? "", username: stats.username, display_name: stats.displayName ?? "" }}
                className="size-8"
              />
              <div className="absolute inset-0 rounded-full ring-1 ring-[#00ff41]/40" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
