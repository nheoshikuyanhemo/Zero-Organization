"use client";

import { UserStats } from "../types";
import { USER_TOKEN_POOL } from "@/features/app/lib/zorg-config";

const UNITS_PER_ZP = 10_000;

interface StatsGridProps {
  stats: UserStats;
  totalGlobalZpoints?: number;
  tapZpUnits?: number;
}

export function StatsGrid({ stats, totalGlobalZpoints, tapZpUnits = 0 }: StatsGridProps) {
  // Live total = settled integer ZP + fractional tap ZP
  const totalZp = stats.zpoints + tapZpUnits / UNITS_PER_ZP;
  const zpDisplay = tapZpUnits > 0
    ? totalZp.toFixed(4)
    : stats.zpoints.toLocaleString();

  // Real token allocation based on share of the 70% user pool
  const estimatedTokens =
    totalGlobalZpoints && totalGlobalZpoints > 0 && stats.zpoints > 0
      ? Math.floor((stats.zpoints / totalGlobalZpoints) * Number(USER_TOKEN_POOL))
      : 0;

  return (
    <div className="mx-4 grid grid-cols-2 gap-3">
      <StatBox
        label="Total Zpoints"
        value={zpDisplay}
        suffix="ZP"
        highlight
      />
      <StatBox
        label="Total Check-ins"
        value={stats.totalCheckIns.toString()}
        suffix="days"
      />
      <StatBox
        label="Best Streak"
        value={stats.longestStreak.toString()}
        suffix="days"
      />
      <StatBox
        label="Est. ZORG Tokens"
        value={formatTokens(estimatedTokens)}
        suffix="ZORG"
        dim={estimatedTokens === 0}
        glow={estimatedTokens > 0}
      />
    </div>
  );
}

function StatBox({
  label,
  value,
  suffix,
  highlight,
  dim,
  glow,
}: {
  label: string;
  value: string;
  suffix: string;
  highlight?: boolean;
  dim?: boolean;
  glow?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[#00ff41]/10 bg-[#0a0a0a] p-3">
      <p className="font-mono text-[10px] text-[#00ff41]/40 uppercase tracking-widest mb-1">
        {label}
      </p>
      <div className="flex items-end gap-1">
        <span
          className={`font-mono text-xl font-black leading-none ${
            highlight
              ? "text-[#00ff41]"
              : dim
              ? "text-white/30"
              : "text-white"
          }`}
          style={
            highlight || glow ? { textShadow: "0 0 8px #00ff41" } : undefined
          }
        >
          {value}
        </span>
        <span className="font-mono text-[10px] text-[#00ff41]/40 mb-0.5">
          {suffix}
        </span>
      </div>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n === 0) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}
