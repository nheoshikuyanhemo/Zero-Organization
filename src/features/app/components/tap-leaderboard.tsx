"use client";

import { useEffect, useState } from "react";
import { getTapLeaderboard } from "@/db/actions/tap-actions";

const UNITS_PER_ZP = 10_000;

type TapEntry = {
  fid: number;
  username: string;
  displayName: string;
  pfpUrl: string | null | undefined;
  tapZpUnits: number;
  tapZpCredited: number;
  zpoints: number;
};

// Neon greens to purples — distinct from the check-in leaderboard palette
const TAPPER_COLORS = [
  "#00ff41", "#39ff14", "#00ffd5", "#00d4ff", "#00aaff",
  "#7b5ea7", "#9b59b6", "#8e44ad", "#6c3483", "#5b2c6f",
];

function formatTapZp(units: number): string {
  const zp = units / UNITS_PER_ZP;
  if (zp >= 1000) return (zp / 1000).toFixed(2) + "K";
  if (zp >= 1) return zp.toFixed(2);
  return zp.toFixed(4);
}

function TapBar({ units, maxUnits, color }: { units: number; maxUnits: number; color: string }) {
  const pct = maxUnits > 0 ? (units / maxUnits) * 100 : 0;
  return (
    <div className="flex-1 h-1 bg-[#111] rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${pct}%`, backgroundColor: color, boxShadow: `0 0 4px ${color}` }}
      />
    </div>
  );
}

export function TapLeaderboard({ currentFid }: { currentFid?: number }) {
  const [entries, setEntries] = useState<TapEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getTapLeaderboard(20)
      .then(setEntries)
      .catch(err => console.error("Failed to load tap leaderboard:", err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="font-mono text-sm text-[#00ff41]/40 animate-pulse tracking-widest">LOADING...</p>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="mx-4 rounded-xl border border-[#00ff41]/20 bg-[#0a0a0a] p-8 text-center">
        <p className="font-mono text-2xl text-[#00ff41]/20 mb-2">[ ]</p>
        <p className="font-mono text-sm text-white/40">No tappers yet.</p>
        <p className="font-mono text-xs text-[#00ff41]/30 mt-1">Be the first to stack tap ZP.</p>
      </div>
    );
  }

  const maxUnits = entries[0]?.tapZpUnits ?? 1;
  const totalTapUnits = entries.reduce((s, e) => s + e.tapZpUnits, 0);
  const rankColors = ["text-yellow-400", "text-gray-300", "text-orange-400"];

  return (
    <div className="pb-6 space-y-4">

      {/* Summary bar */}
      <div className="mx-4 rounded-xl border border-[#00ff41]/20 bg-[#0a0a0a] p-4">
        <div className="flex items-center justify-between mb-1">
          <p className="font-mono text-[10px] text-[#00ff41]/40 uppercase tracking-widest">
            Total Tap ZP Earned
          </p>
          <p className="font-mono text-[10px] text-[#00ff41]/30">
            {formatTapZp(totalTapUnits)} ZP
          </p>
        </div>
        {/* Stacked bar — top 10 tappers */}
        <div className="flex rounded-lg overflow-hidden h-3 gap-px mt-2">
          {entries.slice(0, 10).map((e, i) => {
            const pct = totalTapUnits > 0 ? (e.tapZpUnits / totalTapUnits) * 100 : 0;
            return (
              <div
                key={e.fid}
                style={{
                  width: `${pct}%`,
                  backgroundColor: TAPPER_COLORS[i] ?? "#00ff41",
                  minWidth: pct > 0.5 ? undefined : "2px",
                  flexShrink: 0,
                }}
                title={`@${e.username}: ${formatTapZp(e.tapZpUnits)} ZP`}
              />
            );
          })}
        </div>
        {/* Top 3 legend */}
        <div className="flex gap-4 mt-2">
          {entries.slice(0, 3).map((e, i) => (
            <div key={e.fid} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: TAPPER_COLORS[i] }} />
              <span className="font-mono text-[10px] text-white/40 truncate max-w-[64px]">@{e.username}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Rankings */}
      <div className="px-4 space-y-2">
        <p className="font-mono text-[10px] text-[#00ff41]/40 uppercase tracking-widest mb-1">
          Tap Rankings
        </p>

        {entries.map((entry, i) => {
          const isMe = entry.fid === currentFid;
          const color = TAPPER_COLORS[i] ?? "#00ff41";
          const tapZp = entry.tapZpUnits / UNITS_PER_ZP;
          const freePct = entry.tapZpCredited > 0
            ? Math.round((Math.min(entry.tapZpCredited, 10) / entry.tapZpCredited) * 100)
            : 0;

          return (
            <div
              key={entry.fid}
              className={`rounded-lg border p-3 ${
                isMe
                  ? "border-[#00ff41]/50 bg-[#00ff41]/5"
                  : "border-[#00ff41]/10 bg-[#0a0a0a]"
              }`}
            >
              {/* Top row */}
              <div className="flex items-center gap-2.5 mb-2">
                {/* Rank */}
                <span className={`font-mono text-xs font-black w-5 text-center flex-shrink-0 ${
                  i < 3 ? rankColors[i] : "text-white/25"
                }`}>
                  {i + 1}
                </span>

                {/* Avatar */}
                <div className="w-7 h-7 rounded-full bg-[#111] border border-[#00ff41]/20 overflow-hidden flex-shrink-0">
                  {entry.pfpUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={entry.pfpUrl} alt={entry.username} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="font-mono text-[10px] text-[#00ff41]/40">
                        {entry.username.slice(0, 2).toUpperCase()}
                      </span>
                    </div>
                  )}
                </div>

                {/* Name + subtag */}
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-xs font-bold text-white truncate leading-none">
                    {entry.displayName || entry.username}
                    {isMe && <span className="ml-1 text-[#00ff41] text-[10px]"> you</span>}
                  </p>
                  <p className="font-mono text-[10px] text-white/25 mt-0.5">
                    👆 {tapZp >= 1
                      ? `${tapZp.toFixed(2)} tap ZP`
                      : `${tapZp.toFixed(4)} tap ZP`
                    }
                  </p>
                </div>

                {/* Total ZP (tap units as fractional display) */}
                <div className="text-right flex-shrink-0">
                  <p className="font-mono text-sm font-black leading-none" style={{ color }}>
                    {formatTapZp(entry.tapZpUnits)}
                  </p>
                  <p className="font-mono text-[10px] text-white/25 mt-0.5">ZP</p>
                </div>
              </div>

              {/* Progress bar vs #1 tapper */}
              <div className="flex items-center gap-2">
                <TapBar units={entry.tapZpUnits} maxUnits={maxUnits} color={color} />
                <span className="font-mono text-[10px] text-white/30 flex-shrink-0 w-24 text-right">
                  +{entry.zpoints.toLocaleString()} check-in ZP
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
