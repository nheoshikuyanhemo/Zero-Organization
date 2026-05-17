"use client";

import { useEffect, useState } from "react";
import { getTapAchievements } from "@/db/actions/tap-actions";
import { TIER_COLORS } from "@/features/app/lib/tap-achievements";
import type { TapAchievement } from "@/features/app/lib/tap-achievements";

interface TapAchievementsProps {
  fid: number;
}

export function TapAchievements({ fid }: TapAchievementsProps) {
  const [achievements, setAchievements] = useState<TapAchievement[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    getTapAchievements(fid)
      .then(setAchievements)
      .finally(() => setLoading(false));
  }, [fid]);

  if (loading) return (
    <div className="rounded-xl border border-[#00ff41]/15 bg-[#0a0a0a] p-4">
      <p className="font-mono text-[10px] text-[#00ff41]/30 uppercase tracking-widest animate-pulse">
        Loading badges...
      </p>
    </div>
  );

  const unlocked = achievements.filter(a => a.unlocked);
  const locked = achievements.filter(a => !a.unlocked);

  return (
    <div className="rounded-xl border border-[#00ff41]/15 bg-[#0a0a0a] p-4 space-y-3">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] text-[#00ff41]/40 uppercase tracking-widest">
          Tap Badges
        </p>
        <p className="font-mono text-[10px] text-white/25">
          {unlocked.length} / {achievements.length} earned
        </p>
      </div>

      {/* Unlocked badge grid */}
      {unlocked.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {unlocked.map(a => (
            <BadgeCell
              key={a.id}
              achievement={a}
              isOpen={expanded === a.id}
              onToggle={() => setExpanded(prev => prev === a.id ? null : a.id)}
            />
          ))}
        </div>
      )}

      {/* Empty unlocked state */}
      {unlocked.length === 0 && (
        <p className="font-mono text-[10px] text-white/20 text-center py-2">
          Start tapping to earn your first badge.
        </p>
      )}

      {/* Expanded tooltip */}
      {expanded && (() => {
        const a = achievements.find(x => x.id === expanded);
        if (!a) return null;
        const c = TIER_COLORS[a.tier];
        return (
          <div
            className="rounded-lg p-3 border"
            style={{ borderColor: c.border + "66", background: c.bg }}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">{a.emoji}</span>
              <span className="font-mono text-xs font-bold" style={{ color: c.text }}>{a.title}</span>
              <span
                className="font-mono text-[9px] px-1 rounded ml-auto capitalize"
                style={{ color: c.text, background: c.border + "22", border: `1px solid ${c.border}44` }}
              >
                {a.tier}
              </span>
            </div>
            <p className="font-mono text-[10px] text-white/40">{a.description}</p>
          </div>
        );
      })()}

      {/* Locked badges — progress only */}
      {locked.length > 0 && (
        <div className="space-y-2 pt-1 border-t border-white/5">
          <p className="font-mono text-[10px] text-white/20 uppercase tracking-widest">Next up</p>
          {locked.slice(0, 4).map(a => {
            const c = TIER_COLORS[a.tier];
            return (
              <div key={a.id} className="flex items-center gap-3">
                {/* Locked badge */}
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 opacity-30"
                  style={{ border: `1px solid ${c.border}`, background: c.bg }}
                >
                  <span className="text-sm grayscale">{a.emoji}</span>
                </div>
                {/* Progress */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-mono text-[10px] text-white/35 truncate">{a.title}</span>
                    <span className="font-mono text-[9px] text-white/20 flex-shrink-0 ml-1">{a.progressLabel}</span>
                  </div>
                  <div className="h-1 bg-[#111] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${a.progress}%`,
                        backgroundColor: c.border,
                        boxShadow: a.progress > 0 ? `0 0 4px ${c.border}` : "none",
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
          {locked.length > 4 && (
            <p className="font-mono text-[9px] text-white/15 text-center">
              +{locked.length - 4} more locked
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function BadgeCell({
  achievement: a,
  isOpen,
  onToggle,
}: {
  achievement: TapAchievement;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const c = TIER_COLORS[a.tier];

  return (
    <button
      onClick={onToggle}
      className="flex flex-col items-center gap-1 p-2 rounded-lg transition-all active:scale-95"
      style={{
        border: `1px solid ${isOpen ? c.border : c.border + "55"}`,
        background: isOpen ? c.bg : "transparent",
        boxShadow: isOpen ? `0 0 8px ${c.border}44` : "none",
      }}
    >
      <span className="text-xl leading-none">{a.emoji}</span>
      <span
        className="font-mono text-[8px] text-center leading-tight line-clamp-2"
        style={{ color: c.text }}
      >
        {a.title}
      </span>
    </button>
  );
}
