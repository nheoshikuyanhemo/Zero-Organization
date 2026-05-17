"use client";

import { useState, useEffect } from "react";
import { getUserCheckInHistory } from "@/db/actions/checkin-history-actions";
import { getGlobalTotalZpoints } from "@/db/actions/user-stats-actions";
import { getTapHistory, getTapGameState } from "@/db/actions/tap-actions";
import { TapAchievements } from "./tap-achievements";
import { USER_TOKEN_POOL } from "@/features/app/lib/zorg-config";
import { UserStats } from "../types";
import type { CheckInHistoryEntry } from "@/db/actions/checkin-history-actions";

const UNITS_PER_ZP = 10_000;

function formatTapZp(units: number): string {
  const zp = units / UNITS_PER_ZP;
  if (zp >= 1) return zp.toFixed(2);
  if (zp >= 0.01) return zp.toFixed(4);
  return zp.toFixed(4);
}

interface StatsPageProps {
  stats: UserStats | null;
}

// Build a map of YYYY-MM-DD → entry for fast calendar lookup
function buildDateMap(history: CheckInHistoryEntry[]) {
  const map: Record<string, CheckInHistoryEntry> = {};
  for (const entry of history) {
    map[entry.date] = entry;
  }
  return map;
}

// Get the last N months of calendar data, most recent first
function getCalendarMonths(count: number): { year: number; month: number }[] {
  const months = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth() });
  }
  return months;
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay(); // 0=Sun
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const MULTIPLIER_COLORS: Record<number, string> = {
  1: "#00ff41",
  2: "#39ff14",
  3: "#adff2f",
  4: "#ffdd00",
  5: "#ff9900",
};

function MultiplierBadge({ multiplier }: { multiplier: number }) {
  const color = MULTIPLIER_COLORS[multiplier] ?? "#00ff41";
  return (
    <span
      className="font-mono text-[9px] font-black px-1 rounded"
      style={{ color, background: `${color}22`, border: `1px solid ${color}44` }}
    >
      {multiplier}x
    </span>
  );
}

export function StatsPage({ stats }: StatsPageProps) {
  const [history, setHistory] = useState<CheckInHistoryEntry[]>([]);
  const [tapHistoryMap, setTapHistoryMap] = useState<Record<string, number>>({});
  const [totalTapZpUnits, setTotalTapZpUnits] = useState(0); // lifetime tap ZP units (×10000)
  const [tapZpCredited, setTapZpCredited] = useState(0);     // whole ZP from taps credited to userStats
  const [globalZp, setGlobalZp] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!stats) return;
    Promise.all([
      getUserCheckInHistory(stats.fid, 100),
      getGlobalTotalZpoints(),
      getTapHistory(stats.fid, 90),
      getTapGameState(stats.fid),
    ]).then(([h, gzp, tapH, tapState]) => {
      setHistory(h);
      setGlobalZp(gzp);
      // Build date → tapZpUnits map for quick lookup
      const map: Record<string, number> = {};
      for (const t of tapH) map[t.date] = t.tapZpUnits;
      setTapHistoryMap(map);
      // Use the canonical tapZpUnits from tap_game — the authoritative lifetime total
      setTotalTapZpUnits(tapState.tapZpUnits);
      setTapZpCredited(tapState.tapZpCredited);
    }).finally(() => setLoading(false));
  }, [stats?.fid]);

  if (!stats) return (
    <div className="flex items-center justify-center py-16">
      <p className="font-mono text-xs text-[#00ff41]/30 tracking-widest">CONNECT TO VIEW STATS</p>
    </div>
  );

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <p className="font-mono text-xs text-[#00ff41]/40 animate-pulse tracking-widest">LOADING...</p>
    </div>
  );

  const dateMap = buildDateMap(history);
  const months = getCalendarMonths(3); // show 3 months

  // Token estimate — based on settled ZP (integer column in DB)
  const userZp = stats.zpoints;
  const estimatedTokens = globalZp > 0
    ? Math.floor(Number(USER_TOKEN_POOL) * (userZp / globalZp))
    : 0;
  const poolSharePct = globalZp > 0 ? ((userZp / globalZp) * 100).toFixed(2) : "0.00";

  // Tap ZP breakdown — use tapZpCredited (whole ZP actually added to userStats) for accurate split
  const tapZpEarned = totalTapZpUnits / UNITS_PER_ZP;
  const checkInZp = Math.max(0, userZp - tapZpCredited); // ZP purely from check-ins
  const tapZpDisplay = tapZpEarned >= 1
    ? tapZpEarned.toFixed(2)
    : tapZpEarned > 0
    ? tapZpEarned.toFixed(4)
    : "0";
  const hasTapZp = totalTapZpUnits > 0;

  // Next multiplier milestone
  const streak = stats.currentStreak;
  const nextMilestone = streak < 3 ? 3 : streak < 7 ? 7 : streak < 14 ? 14 : streak < 30 ? 30 : null;
  const daysToNext = nextMilestone ? nextMilestone - streak : null;

  const today = new Date().toISOString().split("T")[0];

  return (
    <div className="px-4 pb-6 space-y-4">

      {/* Token estimate hero */}
      <div
        className="rounded-xl border border-[#00ff41]/30 bg-[#0a0a0a] p-4 text-center space-y-1"
        style={{ boxShadow: "0 0 20px rgba(0,255,65,0.05)" }}
      >
        <p className="font-mono text-[10px] text-[#00ff41]/40 uppercase tracking-widest">Estimated ZORG Tokens</p>
        <p
          className="font-mono text-3xl font-black text-[#00ff41] tabular-nums"
          style={{ textShadow: "0 0 12px #00ff41" }}
        >
          {estimatedTokens > 1_000_000
            ? `${(estimatedTokens / 1_000_000).toFixed(2)}M`
            : estimatedTokens.toLocaleString()}
        </p>
        <p className="font-mono text-[10px] text-white/30">
          {poolSharePct}% of 700M user pool · {userZp.toLocaleString()} ZP total
        </p>

        {/* ZP source breakdown — check-in vs tap */}
        <div className="flex items-center justify-center gap-4 pt-1">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-[#00ff41]" style={{ boxShadow: "0 0 4px #00ff41" }} />
            <span className="font-mono text-[10px] text-white/40">
              ⛓ {checkInZp.toLocaleString()} ZP
            </span>
          </div>
          <div className={`flex items-center gap-1.5 ${!hasTapZp ? "opacity-30" : ""}`}>
            <div className="w-2 h-2 rounded-full bg-[#a855f7]" style={hasTapZp ? { boxShadow: "0 0 4px #a855f7" } : {}} />
            <span className="font-mono text-[10px] text-white/40">
              👆 {tapZpDisplay} ZP
            </span>
          </div>
        </div>

        {/* Stacked progress bar: check-in (green) + tap (purple) */}
        <div className="mt-2 h-1.5 rounded-full bg-white/5 overflow-hidden flex">
          {userZp > 0 && (
            <>
              <div
                className="h-full transition-all"
                style={{
                  width: `${Math.max(0, Math.min(100, parseFloat(poolSharePct) * (checkInZp / Math.max(1, userZp))))}%`,
                  background: "linear-gradient(90deg, #00ff41, #39ff14)",
                  boxShadow: "0 0 6px #00ff41",
                  minWidth: checkInZp > 0 ? "2px" : "0",
                }}
              />
              {hasTapZp && tapZpCredited > 0 && (
                <div
                  className="h-full transition-all"
                  style={{
                    width: `${Math.max(0, parseFloat(poolSharePct) * (tapZpCredited / Math.max(1, userZp)))}%`,
                    background: "linear-gradient(90deg, #a855f7, #7c3aed)",
                    boxShadow: "0 0 6px #a855f7",
                    minWidth: "2px",
                  }}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* Key stats row */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Check-ins", value: stats.totalCheckIns.toString() },
          { label: "Streak", value: `${stats.currentStreak}d` },
          { label: "Best", value: `${stats.longestStreak}d` },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-[#00ff41]/15 bg-[#0a0a0a] p-3 text-center">
            <p className="font-mono text-[9px] text-[#00ff41]/40 uppercase tracking-widest">{s.label}</p>
            <p className="font-mono text-xl font-black text-white mt-0.5">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Streak multiplier status */}
      <div className="rounded-xl border border-[#00ff41]/15 bg-[#0a0a0a] p-4 space-y-2">
        <div className="flex items-center justify-between">
          <p className="font-mono text-[10px] text-[#00ff41]/40 uppercase tracking-widest">Streak Power</p>
          <MultiplierBadge multiplier={stats.streakMultiplier} />
        </div>
        {/* Milestone progress bar */}
        <div className="flex gap-1 items-center">
          {[
            { day: 1, label: "1x" },
            { day: 3, label: "2x" },
            { day: 7, label: "3x" },
            { day: 14, label: "4x" },
            { day: 30, label: "5x" },
          ].map((m, i, arr) => {
            const reached = streak >= m.day;
            const isNext = !reached && (i === 0 || streak >= arr[i - 1].day);
            return (
              <div key={m.day} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className={`w-full h-1.5 rounded-full transition-all ${
                    reached ? "bg-[#00ff41]" : "bg-white/10"
                  }`}
                  style={reached ? { boxShadow: "0 0 4px #00ff41" } : {}}
                />
                <span className={`font-mono text-[8px] ${reached ? "text-[#00ff41]" : isNext ? "text-white/40" : "text-white/20"}`}>
                  {m.label}
                </span>
              </div>
            );
          })}
        </div>
        {daysToNext && (
          <p className="font-mono text-[10px] text-white/30 text-center">
            {daysToNext} more day{daysToNext !== 1 ? "s" : ""} to next multiplier
          </p>
        )}
        {!daysToNext && streak >= 30 && (
          <p className="font-mono text-[10px] text-[#ff9900]/60 text-center" style={{ textShadow: "0 0 6px #ff9900" }}>
            MAX POWER — 5x active
          </p>
        )}
      </div>

      {/* Check-in calendar */}
      <div className="rounded-xl border border-[#00ff41]/15 bg-[#0a0a0a] p-4 space-y-4">
        <p className="font-mono text-[10px] text-[#00ff41]/40 uppercase tracking-widest">Check-in Calendar</p>
        {months.map(({ year, month }) => {
          const daysInMonth = getDaysInMonth(year, month);
          const firstDay = getFirstDayOfMonth(year, month);
          const cells: (number | null)[] = [
            ...Array(firstDay).fill(null),
            ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
          ];
          // Pad to full weeks
          while (cells.length % 7 !== 0) cells.push(null);

          return (
            <div key={`${year}-${month}`} className="space-y-1.5">
              <p className="font-mono text-[10px] text-white/30 uppercase tracking-widest">
                {MONTH_NAMES[month]} {year}
              </p>
              {/* Day-of-week header */}
              <div className="grid grid-cols-7 gap-0.5 mb-1">
                {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                  <div key={i} className="text-center font-mono text-[8px] text-white/20">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {cells.map((day, idx) => {
                  if (!day) return <div key={idx} />;
                  const dateStr = formatDate(year, month, day);
                  const entry = dateMap[dateStr];
                  const isToday = dateStr === today;
                  const isFuture = dateStr > today;

                  return (
                    <div
                      key={idx}
                      title={entry ? `${entry.pointsEarned} ZP · ${entry.multiplier}x · Day ${entry.streakDay}` : dateStr}
                      className={`
                        aspect-square rounded flex items-center justify-center
                        font-mono text-[9px] font-bold transition-all
                        ${entry
                          ? "text-black"
                          : isFuture
                          ? "text-white/10"
                          : isToday
                          ? "text-[#00ff41]/60 border border-[#00ff41]/30"
                          : "text-white/20"
                        }
                      `}
                      style={
                        entry
                          ? {
                              background: MULTIPLIER_COLORS[entry.multiplier] ?? "#00ff41",
                              boxShadow: `0 0 4px ${MULTIPLIER_COLORS[entry.multiplier] ?? "#00ff41"}88`,
                            }
                          : {}
                      }
                    >
                      {day}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Legend */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 border-t border-white/5">
          {Object.entries(MULTIPLIER_COLORS).map(([mult, color]) => (
            <div key={mult} className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
              <span className="font-mono text-[9px] text-white/30">{mult}x</span>
            </div>
          ))}
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-sm bg-white/10" />
            <span className="font-mono text-[9px] text-white/30">missed</span>
          </div>
        </div>
      </div>

      {/* Recent activity history — check-ins + tap ZP per day */}
      {history.length > 0 && (
        <div className="rounded-xl border border-[#00ff41]/15 bg-[#0a0a0a] p-4 space-y-2">
          <p className="font-mono text-[10px] text-[#00ff41]/40 uppercase tracking-widest mb-1">
            Recent Activity
          </p>
          <div className="space-y-1">
            {history.slice(0, 10).map((entry) => {
              const tapUnits = tapHistoryMap[entry.date] ?? 0;
              const tapZp = tapUnits > 0 ? formatTapZp(tapUnits) : null;
              const isOnchain = entry.txHash !== null;
              return (
                <div
                  key={entry.id}
                  className="py-2 border-b border-white/5 last:border-0 space-y-1.5"
                >
                  {/* Top row: date + type badge + streak + total ZP */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-white/30 w-20 shrink-0">{entry.date}</span>
                      <span className={`font-mono text-[9px] px-1 rounded font-bold ${
                        isOnchain
                          ? "text-[#00ff41] bg-[#00ff41]/10 border border-[#00ff41]/30"
                          : "text-white/40 bg-white/5 border border-white/10"
                      }`}>
                        {isOnchain ? "⛓ chain" : "free"}
                      </span>
                      <MultiplierBadge multiplier={entry.multiplier} />
                    </div>
                    <div className="text-right">
                      <span className="font-mono text-xs font-bold text-[#00ff41]">
                        +{entry.pointsEarned} ZP
                      </span>
                    </div>
                  </div>
                  {/* Tap row — only shown if user tapped on this day */}
                  {tapZp && (
                    <div className="flex items-center justify-between pl-22">
                      <div className="flex items-center gap-1.5 ml-[88px]">
                        <span className="font-mono text-[9px] text-[#00ff41]/40">👆 tap</span>
                      </div>
                      <span className="font-mono text-[10px] font-bold text-[#00ff41]/60">
                        +{tapZp} ZP
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {history.length > 10 && (
            <p className="font-mono text-[9px] text-white/20 text-center pt-1">
              +{history.length - 10} more check-ins
            </p>
          )}
        </div>
      )}

      {history.length === 0 && (
        <div className="rounded-xl border border-[#00ff41]/10 bg-[#0a0a0a] p-6 text-center">
          <p className="font-mono text-xs text-white/20">No check-ins yet.</p>
          <p className="font-mono text-[10px] text-[#00ff41]/20 mt-1">Check in daily to build your history.</p>
        </div>
      )}

      {/* Tap-only days — days where user tapped but didn't check in */}
      {(() => {
        const checkInDates = new Set(history.map(h => h.date));
        const tapOnlyDays = Object.entries(tapHistoryMap)
          .filter(([date]) => !checkInDates.has(date))
          .sort(([a], [b]) => b.localeCompare(a))
          .slice(0, 5);
        if (tapOnlyDays.length === 0) return null;
        return (
          <div className="rounded-xl border border-[#00ff41]/10 bg-[#0a0a0a] p-4 space-y-1">
            <p className="font-mono text-[10px] text-[#00ff41]/30 uppercase tracking-widest mb-2">
              Tap-only Days
            </p>
            {tapOnlyDays.map(([date, units]) => (
              <div
                key={date}
                className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-white/30 w-20 shrink-0">{date}</span>
                  <span className="font-mono text-[9px] text-[#00ff41]/40">👆 tap only</span>
                </div>
                <span className="font-mono text-[10px] font-bold text-[#00ff41]/60">
                  +{formatTapZp(units)} ZP
                </span>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Tap achievement badges */}
      <TapAchievements fid={stats.fid} />

    </div>
  );
}
