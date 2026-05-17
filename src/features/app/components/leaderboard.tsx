"use client";

import { useEffect, useState } from "react";
import { getLeaderboardWithTapZp, getGlobalTotalZpoints } from "@/db/actions/user-stats-actions";
import { USER_TOKEN_POOL } from "@/features/app/lib/zorg-config";
import { TapLeaderboard } from "./tap-leaderboard";

type LeaderboardTab = "checkin" | "tap";

const UNITS_PER_ZP = 10_000;

type LeaderboardEntry = {
  fid: number;
  username: string;
  displayName: string;
  pfpUrl: string | null | undefined;
  zpoints: number;
  currentStreak: number;
  longestStreak: number;
  totalCheckIns: number;
  tapZpUnits: number;
};

function formatZpDisplay(zpoints: number, tapZpUnits: number): string {
  // Carry-over fractional tap ZP: units that haven't crossed the 1 ZP threshold yet
  const fracUnits = tapZpUnits % UNITS_PER_ZP;
  if (fracUnits === 0) return zpoints.toLocaleString();
  const total = zpoints + fracUnits / UNITS_PER_ZP;
  return total.toFixed(4);
}

// Distinct neon colors for the stacked bar — top 10 get their own slice
const SLICE_COLORS = [
  "#00ff41", "#39ff14", "#00e536", "#7fff00", "#adff2f",
  "#00ffaa", "#00ffd5", "#00d4ff", "#00aaff", "#0077ff",
];
const REST_COLOR = "#1a2e1a";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

function formatPct(n: number): string {
  if (n < 0.01) return "<0.01%";
  return n.toFixed(2) + "%";
}

export function Leaderboard({ currentFid }: { currentFid?: number }) {
  const [tab, setTab] = useState<LeaderboardTab>("checkin");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [totalZpoints, setTotalZpoints] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [lb, total] = await Promise.all([
          getLeaderboardWithTapZp(20),
          getGlobalTotalZpoints(),
        ]);
        setEntries(lb);
        setTotalZpoints(total);
      } catch (err) {
        console.error("Failed to load leaderboard:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Tab toggle — always rendered above the content
  const TabToggle = (
    <div className="mx-4 mb-2 flex gap-1 bg-[#0a0a0a] rounded-lg p-1 border border-[#00ff41]/10">
      {(["checkin", "tap"] as LeaderboardTab[]).map((t) => (
        <button
          key={t}
          onClick={() => setTab(t)}
          className={`flex-1 py-2 rounded-md font-mono text-xs font-bold tracking-widest uppercase transition-all duration-150 ${
            tab === t
              ? "bg-[#00ff41] text-black"
              : "text-[#00ff41]/50 hover:text-[#00ff41]/80"
          }`}
          style={tab === t ? { boxShadow: "0 0 10px rgba(0,255,65,0.4)" } : {}}
        >
          {t === "checkin" ? "⛓ Check-in" : "👆 Tappers"}
        </button>
      ))}
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-3">
        {TabToggle}
        <div className="flex items-center justify-center py-16">
          <p className="font-mono text-sm text-[#00ff41]/40 animate-pulse tracking-widest">
            LOADING...
          </p>
        </div>
      </div>
    );
  }

  if (tab === "tap") {
    return (
      <div className="space-y-3">
        {TabToggle}
        <TapLeaderboard currentFid={currentFid} />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="space-y-3">
        {TabToggle}
        <div className="mx-4 rounded-xl border border-[#00ff41]/20 bg-[#0a0a0a] p-8 text-center">
          <p className="font-mono text-2xl text-[#00ff41]/20 mb-2">[ ]</p>
          <p className="font-mono text-sm text-white/40">No check-ins yet.</p>
          <p className="font-mono text-xs text-[#00ff41]/30 mt-1">Be the first to stack Zpoints.</p>
        </div>
      </div>
    );
  }

  // Compute each entry's token allocation from the 70% user pool
  const top10 = entries.slice(0, 10);
  const top10Zp = top10.reduce((s, e) => s + e.zpoints, 0);
  const restZp = Math.max(0, totalZpoints - top10Zp);

  // Stacked bar segments: top 10 + "rest" bucket
  const segments = top10.map((e, i) => ({
    fid: e.fid,
    name: e.username,
    zpoints: e.zpoints,
    pct: totalZpoints > 0 ? (e.zpoints / totalZpoints) * 100 : 0,
    color: SLICE_COLORS[i] ?? "#00ff41",
  }));
  if (restZp > 0) {
    segments.push({
      fid: -1,
      name: "others",
      zpoints: restZp,
      pct: totalZpoints > 0 ? (restZp / totalZpoints) * 100 : 0,
      color: REST_COLOR,
    });
  }

  const rankColors = ["text-yellow-400", "text-gray-300", "text-orange-400"];

  return (
    <div className="pb-6 space-y-4">
      {TabToggle}

      {/* ── Stacked allocation bar ── */}
      <div className="mx-4 rounded-xl border border-[#00ff41]/20 bg-[#0a0a0a] p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="font-mono text-[10px] text-[#00ff41]/40 uppercase tracking-widest">
            700M ZORG User Pool
          </p>
          <p className="font-mono text-[10px] text-[#00ff41]/30">
            {totalZpoints.toLocaleString()} ZP total
          </p>
        </div>

        {/* Stacked bar */}
        <div className="flex rounded-lg overflow-hidden h-5 gap-px mb-3">
          {segments.map((s) => (
            <div
              key={s.fid}
              style={{
                width: `${s.pct}%`,
                backgroundColor: s.color,
                minWidth: s.pct > 0.5 ? undefined : "2px",
                flexShrink: 0,
              }}
              title={`${s.name}: ${formatPct(s.pct)}`}
            />
          ))}
        </div>

        {/* Legend — top 5 only to keep it tight */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {segments.slice(0, 5).map((s, i) => (
            <div key={s.fid} className="flex items-center gap-1.5">
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: s.color }}
              />
              <span className="font-mono text-[10px] text-white/50 truncate">
                @{s.name}
              </span>
              <span className="font-mono text-[10px] ml-auto flex-shrink-0"
                style={{ color: s.color }}>
                {formatPct(s.pct)}
              </span>
            </div>
          ))}
          {restZp > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full flex-shrink-0 bg-white/10" />
              <span className="font-mono text-[10px] text-white/30">others</span>
              <span className="font-mono text-[10px] text-white/20 ml-auto flex-shrink-0">
                {formatPct((restZp / totalZpoints) * 100)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Per-user rows ── */}
      <div className="px-4 space-y-2">
        <p className="font-mono text-[10px] text-[#00ff41]/40 uppercase tracking-widest mb-1">
          Rankings
        </p>

        {entries.map((entry, i) => {
          const isMe = entry.fid === currentFid;
          const userPoolShare = totalZpoints > 0 ? entry.zpoints / totalZpoints : 0;
          const estimatedTokens = Math.floor(Number(USER_TOKEN_POOL) * userPoolShare);
          const barPct = entries[0]?.zpoints > 0
            ? (entry.zpoints / entries[0].zpoints) * 100
            : 0;
          const color = i < 10 ? SLICE_COLORS[i] : "#00ff41";

          return (
            <div
              key={entry.fid}
              className={`rounded-lg border p-3 ${
                isMe
                  ? "border-[#00ff41]/50 bg-[#00ff41]/5"
                  : "border-[#00ff41]/10 bg-[#0a0a0a]"
              }`}
            >
              {/* Top row: rank · avatar · name · zpoints */}
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

                {/* Name */}
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-xs font-bold text-white truncate leading-none">
                    {entry.displayName || entry.username}
                    {isMe && <span className="ml-1 text-[#00ff41] text-[10px]"> you</span>}
                  </p>
                  <p className="font-mono text-[10px] text-white/25 mt-0.5">
                    {entry.currentStreak}d streak · {entry.totalCheckIns} check-ins
                  </p>
                </div>

                {/* ZP + tokens */}
                <div className="text-right flex-shrink-0">
                  <p className="font-mono text-sm font-black leading-none"
                    style={{ color }}>
                    {formatZpDisplay(entry.zpoints, entry.tapZpUnits)}
                  </p>
                  <p className="font-mono text-[10px] text-white/25 mt-0.5">
                    ZP{entry.tapZpUnits % UNITS_PER_ZP > 0 && (
                      <span className="ml-1 text-[#00ff41]/40">+tap</span>
                    )}
                  </p>
                </div>
              </div>

              {/* Progress bar vs #1 */}
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1 bg-[#111] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${barPct}%`,
                      backgroundColor: color,
                      boxShadow: isMe ? `0 0 4px ${color}` : undefined,
                    }}
                  />
                </div>
                <span className="font-mono text-[10px] text-white/30 flex-shrink-0 w-20 text-right">
                  ~{formatTokens(estimatedTokens)} ZORG
                </span>
              </div>

              {/* Share percentage */}
              <p className="font-mono text-[10px] mt-1 text-right"
                style={{ color: `${color}80` }}>
                {formatPct(userPoolShare * 100)} of pool
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
