"use client";

import { useEffect, useState } from "react";
import { useReadContract } from "wagmi";
import { formatEther } from "viem";
import { kvGet } from "@/neynar-db-sdk";
import { getGlobalTotalZpoints, getTotalEthCollected } from "@/db/actions/user-stats-actions";
import { getDistributionStats } from "@/db/actions/distribution-actions";
import { getSessionInfo } from "@/db/actions/session-actions";
import { BANK_ABI } from "@/features/app/lib/bank-abi";
import {
  USER_ALLOC_BPS,
  LIQUIDITY_ALLOC_BPS,
  DEV_ALLOC_BPS,
  USER_TOKEN_POOL,
  LIQUIDITY_TOKEN_POOL,
  DEV_TOKEN_AMOUNT,
} from "@/features/app/lib/zorg-config";

const MILESTONES = [
  { streak: "3–5",  multiplier: 2, label: "Streak 3–5" },
  { streak: "6–8",  multiplier: 3, label: "Streak 6–8" },
  { streak: "9–11", multiplier: 4, label: "Streak 9–11" },
  { streak: "12+",  multiplier: 5, label: "Streak 12+" },
];

const TOKENOMICS = [
  {
    label: "Check-in Users",
    pct: USER_ALLOC_BPS / 100,
    amount: Number(USER_TOKEN_POOL).toLocaleString(),
    color: "#00ff41",
    desc: "Distributed to all users proportional to Zpoints",
  },
  {
    label: "Liquidity Pool",
    pct: LIQUIDITY_ALLOC_BPS / 100,
    amount: Number(LIQUIDITY_TOKEN_POOL).toLocaleString(),
    color: "#39d353",
    desc: "Funded by protocol fees — seeded on Day 101",
  },
  {
    label: "Dev",
    pct: DEV_ALLOC_BPS / 100,
    amount: Number(DEV_TOKEN_AMOUNT).toLocaleString(),
    color: "#00aa2a",
    desc: "Development, operations, and future growth",
  },
];

interface LiveStats {
  tokenAddress: string | null;
  bankAddress: string | null;
  totalZpoints: number;
  ethCollectedDb: number;
  daysElapsed: number;
  daysRemaining: number;
  isEnded: boolean;
  distPaid: number;
  distTotal: number;
}

export function AboutPanel() {
  const [live, setLive] = useState<LiveStats | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [addr, bankAddr, zp, eth, session, dist] = await Promise.all([
          kvGet("zorg:token_address"),
          kvGet("zorg:bank_address"),
          getGlobalTotalZpoints(),
          getTotalEthCollected(),
          getSessionInfo(),
          getDistributionStats(),
        ]);
        setLive({
          tokenAddress: addr,
          bankAddress: bankAddr,
          totalZpoints: zp,
          ethCollectedDb: eth,
          daysElapsed: session.daysElapsed,
          daysRemaining: session.daysRemaining,
          isEnded: session.isEnded,
          distPaid: dist.paid,
          distTotal: dist.total,
        });
      } catch {
        // non-critical — static content still shows
      }
    }
    load();
  }, []);

  // Live ETH balance from ZorgBank contract (real-time, overrides DB sum when bank is deployed)
  const { data: bankEthBalanceRaw } = useReadContract({
    address: live?.bankAddress ? (live.bankAddress as `0x${string}`) : undefined,
    abi: BANK_ABI,
    functionName: "ethBalance",
    query: { enabled: !!live?.bankAddress, refetchInterval: 15_000 },
  });

  // Use on-chain balance if available, else fall back to DB sum
  const ethCollected = bankEthBalanceRaw !== undefined
    ? parseFloat(formatEther(bankEthBalanceRaw as bigint))
    : (live?.ethCollectedDb ?? 0);

  const ethSource = live?.bankAddress ? "on-chain" : "db";

  return (
    <div className="px-4 pb-6 space-y-4">

      {/* ── Live Token Stats ── */}
      <div className="rounded-xl border border-[#00ff41]/30 bg-[#0a0a0a] p-4 space-y-3"
        style={{ boxShadow: "0 0 16px rgba(0,255,65,0.04)" }}>
        <div className="flex items-center justify-between">
          <p className="font-mono text-[10px] text-[#00ff41]/40 uppercase tracking-widest">Live Stats</p>
          {live?.tokenAddress ? (
            <a
              href={`https://basescan.org/token/${live.tokenAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[9px] text-blue-400 hover:text-blue-300 underline"
            >
              View on Basescan →
            </a>
          ) : (
            <span className="font-mono text-[9px] text-white/20 uppercase tracking-widest">Not deployed yet</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          {[
            {
              label: "Total Supply",
              value: "1,000,000,000",
              suffix: "ZORG",
              color: "text-[#00ff41]",
              glow: true,
            },
            {
              label: "Network",
              value: "Base",
              suffix: "L2",
              color: "text-white",
              glow: false,
            },
            {
              label: "Total Zpoints",
              value: live ? live.totalZpoints.toLocaleString() : "—",
              suffix: "ZP",
              color: "text-white",
              glow: false,
            },
            {
              label: "ETH in Bank",
              value: live ? ethCollected.toFixed(6) : "—",
              suffix: ethSource === "on-chain" ? "ETH · live" : "ETH · db",
              color: "text-[#00ffaa]",
              glow: false,
            },
            {
              label: "Session Day",
              value: live ? `${live.daysElapsed} / 100` : "—",
              suffix: live?.isEnded ? "ENDED" : `${live?.daysRemaining ?? 0}d left`,
              color: live?.isEnded ? "text-red-400" : "text-white",
              glow: false,
            },
            {
              label: "Distributions",
              value: live && live.distTotal > 0 ? `${live.distPaid}/${live.distTotal}` : "Pending",
              suffix: live && live.distTotal > 0 ? "sent" : "",
              color: live && live.distPaid > 0 ? "text-[#00ff41]" : "text-white/40",
              glow: false,
            },
          ].map((s) => (
            <div key={s.label} className="rounded-lg bg-black/40 border border-[#00ff41]/10 p-3">
              <p className="font-mono text-[9px] text-[#00ff41]/30 uppercase tracking-widest mb-0.5">{s.label}</p>
              <p className={`font-mono text-sm font-black leading-none ${s.color}`}
                style={s.glow ? { textShadow: "0 0 6px #00ff41" } : undefined}>
                {s.value}
              </p>
              {s.suffix && (
                <p className="font-mono text-[9px] text-white/25 mt-0.5">{s.suffix}</p>
              )}
            </div>
          ))}
        </div>

        {live?.tokenAddress && (
          <div className="bg-black/40 rounded px-3 py-2 border border-[#00ff41]/15">
            <p className="font-mono text-[9px] text-[#00ff41]/30 uppercase tracking-widest mb-0.5">Contract Address</p>
            <p className="font-mono text-[9px] text-[#00ff41] break-all">{live.tokenAddress}</p>
          </div>
        )}
      </div>

      {/* ── Token overview ── */}
      <div className="rounded-xl border border-[#00ff41]/20 bg-[#0a0a0a] p-4">
        <p className="font-mono text-[10px] text-[#00ff41]/40 uppercase tracking-widest mb-3">
          ZORG Token
        </p>
        <p className="font-mono text-sm text-white/80 leading-relaxed">
          Total supply:{" "}
          <span className="text-[#00ff41] font-black">1,000,000,000 ZORG</span>
        </p>
        <p className="font-mono text-xs text-white/50 mt-1 leading-relaxed">
          Deployed on <span className="text-[#00ff41]">Base</span> · distributed
          automatically on Day 101
        </p>
      </div>

      {/* ── Tokenomics ── */}
      <div className="rounded-xl border border-[#00ff41]/20 bg-[#0a0a0a] p-4 space-y-4">
        <p className="font-mono text-[10px] text-[#00ff41]/40 uppercase tracking-widest">
          Tokenomics
        </p>

        <div className="flex rounded overflow-hidden h-3 gap-px">
          {TOKENOMICS.map((t) => (
            <div
              key={t.label}
              style={{ width: `${t.pct}%`, backgroundColor: t.color }}
              title={`${t.label}: ${t.pct}%`}
            />
          ))}
        </div>

        <div className="space-y-3">
          {TOKENOMICS.map((t) => (
            <div key={t.label} className="flex items-start gap-3">
              <div
                className="w-2 h-2 rounded-full mt-1 flex-shrink-0"
                style={{ backgroundColor: t.color }}
              />
              <div className="flex-1">
                <div className="flex justify-between items-baseline">
                  <span className="font-mono text-xs font-bold text-white">
                    {t.pct}% — {t.label}
                  </span>
                  <span className="font-mono text-[10px]" style={{ color: t.color }}>
                    {t.amount}
                  </span>
                </div>
                <p className="font-mono text-[10px] text-white/30 mt-0.5">
                  {t.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Your allocation formula ── */}
      <div className="rounded-xl border border-[#00ff41]/20 bg-[#0a0a0a] p-4">
        <p className="font-mono text-[10px] text-[#00ff41]/40 uppercase tracking-widest mb-3">
          Your Allocation
        </p>
        <div className="bg-[#111] rounded-lg p-3 font-mono text-xs text-[#00ff41] text-center tracking-wide border border-[#00ff41]/10 leading-relaxed">
          Your ZORG = (Your ZP / Total ZP) × 700,000,000
        </div>
        <p className="font-mono text-[10px] text-white/30 mt-2 text-center">
          More Zpoints = larger share of the 70% user pool
        </p>
      </div>

      {/* ── Protocol fee ── */}
      <div className="rounded-xl border border-[#00ff41]/20 bg-[#0a0a0a] p-4">
        <p className="font-mono text-[10px] text-[#00ff41]/40 uppercase tracking-widest mb-2">
          Protocol Fee
        </p>
        <p className="font-mono text-xs text-white/50 leading-relaxed">
          A <span className="text-[#00ff41]">0.1%</span> protocol fee is applied
          to every check-in. These fees fund the{" "}
          <span className="text-[#00ff41]">25% liquidity pool</span> in full,
          ensuring ZORG has healthy on-chain liquidity from day one.
        </p>
      </div>

      {/* ── Check-in modes ── */}
      <div className="rounded-xl border border-[#00ff41]/20 bg-[#0a0a0a] p-4 space-y-3">
        <p className="font-mono text-[10px] text-[#00ff41]/40 uppercase tracking-widest">Check-In Modes</p>

        {/* Paid */}
        <div className="rounded-lg border border-[#00ff41]/25 bg-black/40 p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs font-bold text-[#00ff41]">Paid Check-In</span>
            <span className="font-mono text-[10px] text-[#00ff41]/60">100–200 ZP × multiplier</span>
          </div>
          <p className="font-mono text-[10px] text-white/40 leading-relaxed">
            Pay a small ETH fee (scales day 1–100). Earns full base points × streak multiplier. Fees go to ZorgBank.
          </p>
        </div>

        {/* Free */}
        <div className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs font-bold text-white/50">Free Check-In</span>
            <span className="font-mono text-[10px] text-white/30">1+ ZP / day</span>
          </div>
          <p className="font-mono text-[10px] text-white/30 leading-relaxed">
            No wallet needed. Earns 1 ZP/day base (+1 ZP bonus every 10-day streak). Keeps your streak alive on days you don&apos;t want to pay.
          </p>
        </div>
      </div>

      {/* ── Streak multipliers ── */}
      <div className="rounded-xl border border-[#00ff41]/20 bg-[#0a0a0a] p-4">
        <p className="font-mono text-[10px] text-[#00ff41]/40 uppercase tracking-widest mb-3">
          Streak Multipliers
        </p>
        <p className="font-mono text-[10px] text-white/30 mb-2">
          Every 3 paid check-ins unlocks the next tier. Base points scale 100–200 ZP over 100 days.
        </p>
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="font-mono text-xs text-white/60">Streak 1–2</span>
            <span className="font-mono text-xs font-bold text-white">1× base ZP / day</span>
          </div>
          {MILESTONES.map((m) => (
            <div key={m.streak} className="flex justify-between items-center">
              <span className="font-mono text-xs text-white/60">{m.label}</span>
              <span className="font-mono text-xs font-bold text-[#00ff41]">
                {m.multiplier}× base ZP / day
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Rules ── */}
      <div className="rounded-xl border border-[#00ff41]/20 bg-[#0a0a0a] p-4">
        <p className="font-mono text-[10px] text-[#00ff41]/40 uppercase tracking-widest mb-3">
          Rules
        </p>
        <ul className="space-y-1.5">
          {[
            "Check in once per day — paid or free",
            "Free check-in: 1 ZP flat, no multiplier, no ETH",
            "Paid check-in: full ZP × streak multiplier",
            "Miss a day → streak resets to 1",
            "Every 3-day streak unlocks next multiplier tier",
            "Session runs for 100 days",
            "Tokens auto-distribute on Day 101",
          ].map((rule) => (
            <li key={rule} className="flex items-start gap-2">
              <span className="text-[#00ff41] font-mono text-xs mt-0.5">→</span>
              <span className="font-mono text-xs text-white/70">{rule}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* ── Community ── */}
      <div className="rounded-xl border border-[#00ff41]/20 bg-[#0a0a0a] p-4 flex items-center justify-between">
        <div>
          <p className="font-mono text-[10px] text-[#00ff41]/40 uppercase tracking-widest mb-1">Community</p>
          <p className="font-mono text-xs text-white/50">Follow ZORG for updates &amp; announcements</p>
        </div>
        <a
          href="https://x.com/wearezorg"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 bg-black border border-white/20 hover:border-white/50 rounded-lg px-3 py-2 transition-colors"
        >
          {/* X logo */}
          <svg width="14" height="14" viewBox="0 0 300 300" fill="white" xmlns="http://www.w3.org/2000/svg">
            <path d="M178.57 127.15 290.27 0h-26.46l-97.03 110.38L89.34 0H0l117.13 166.93L0 300.25h26.46l102.4-116.59 81.8 116.59h89.34M36.01 19.54H76.66l187.13 262.13h-40.66"/>
          </svg>
          <span className="font-mono text-xs font-bold text-white">@wearezorg</span>
        </a>
      </div>

    </div>
  );
}
