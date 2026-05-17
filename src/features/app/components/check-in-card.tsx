"use client";

import { useState, useEffect, useRef } from "react";
import {
  useAccount,
  useConnect,
  useSendTransaction,
  useWaitForTransactionReceipt,
  useSwitchChain,
} from "wagmi";
import { parseEther } from "viem";
import { base } from "viem/chains";
import { UserStats, CheckInResult } from "../types";
import { performCheckIn as dbCheckIn, getTodayCheckInStatus } from "@/db/actions/user-stats-actions";
import {
  DEV_WALLET_ADDRESS,
  getCheckinFeeEth,
  formatCheckinFee,
  getStreakMultiplier,
} from "@/features/app/lib/zorg-config";
import { kvGet } from "@/neynar-db-sdk";

function getTodayDateString(): string {
  return new Date().toISOString().split("T")[0];
}

function getNextMilestone(streak: number): { days: number; multiplier: number } | null {
  const nextStreakFor3x = Math.ceil((streak + 1) / 3) * 3;
  const nextMultiplier = getStreakMultiplier(nextStreakFor3x);
  const currentMultiplier = getStreakMultiplier(streak);
  if (nextMultiplier <= currentMultiplier) return null;
  return { days: nextStreakFor3x, multiplier: nextMultiplier };
}

interface CheckInCardProps {
  stats: UserStats;
  sessionDay: number;
  onCheckIn: (updatedStats: UserStats, result: CheckInResult) => void;
}

export function CheckInCard({ stats, sessionDay, onCheckIn }: CheckInCardProps) {
  const today = getTodayDateString();
  const nextMilestone = getNextMilestone(stats.currentStreak);

  // Points preview — next streak day (current + 1)
  const nextStreak = stats.currentStreak + 1;
  const onchainPoints = 100 + nextStreak;
  // Free: 1 ZP + floor(streak/10) — matches server calculation
  const freePointsDisplay = (1 + Math.floor(nextStreak / 10)).toString();

  // Fee
  const feeEthStr = getCheckinFeeEth(sessionDay);
  const feeDisplay = formatCheckinFee(sessionDay);
  const feeWei = parseEther(feeEthStr);

  // Fee destination
  const [feeDestination, setFeeDestination] = useState<`0x${string}`>(DEV_WALLET_ADDRESS as `0x${string}`);
  const [usesBank, setUsesBank] = useState(false);

  useEffect(() => {
    kvGet("zorg:bank_address").then((addr) => {
      if (addr && addr.startsWith("0x") && addr.length === 42) {
        setFeeDestination(addr as `0x${string}`);
        setUsesBank(true);
      }
    });
  }, []);

  // Per-mode done state — seeded from DB on mount so refresh shows correct state
  const [onchainDone, setOnchainDone] = useState(false);
  const [freeDone, setFreeDone] = useState(false);
  const [statusLoaded, setStatusLoaded] = useState(false);

  useEffect(() => {
    getTodayCheckInStatus(stats.fid).then(({ onchainDone: od, freeDone: fd }) => {
      setOnchainDone(od);
      setFreeDone(fd);
      setStatusLoaded(true);
    }).catch(() => setStatusLoaded(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats.fid]);

  // Wallet
  const { address, isConnected, chain } = useAccount();
  const { connect, connectors } = useConnect();
  const { switchChainAsync } = useSwitchChain();

  // Onchain tx state
  const {
    sendTransaction,
    data: txHash,
    isPending: isSending,
    reset: resetTx,
    error: sendError,
  } = useSendTransaction();

  const {
    isLoading: isConfirming,
    isSuccess: isTxConfirmed,
    error: confirmError,
  } = useWaitForTransactionReceipt({ hash: txHash });

  // Recording state
  const [isRecordingOnchain, setIsRecordingOnchain] = useState(false);
  const [isRecordingFree, setIsRecordingFree] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [freeError, setFreeError] = useState<string | null>(null);

  // Guard: only record once per confirmed tx
  const recordedTxRef = useRef<string | null>(null);

  // ── Onchain: record only after tx confirmed with a real hash ──
  useEffect(() => {
    if (!isTxConfirmed || !txHash || isRecordingOnchain) return;
    if (recordedTxRef.current === txHash) return; // already recorded
    recordedTxRef.current = txHash;
    recordOnchainCheckIn(txHash);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTxConfirmed, txHash]);

  useEffect(() => {
    if (!sendError) return;
    const msg = sendError.message ?? "";
    if (!msg.toLowerCase().includes("rejected") && !msg.toLowerCase().includes("denied") && !msg.toLowerCase().includes("user")) {
      setTxError("Transaction failed. Ensure your wallet has ETH on Base.");
    }
    resetTx();
  }, [sendError, resetTx]);

  useEffect(() => {
    if (!confirmError) return;
    setTxError("Transaction failed to confirm on Base. Try again.");
    resetTx();
  }, [confirmError, resetTx]);

  async function recordOnchainCheckIn(confirmedTxHash: string) {
    setIsRecordingOnchain(true);
    setTxError(null);
    try {
      const result = await dbCheckIn(
        stats.fid,
        stats.username,
        stats.displayName,
        stats.pfpUrl ?? undefined,
        confirmedTxHash,  // ← must be a confirmed on-chain tx hash
        feeEthStr,
        sessionDay,
        false             // not free
      );

      if (!result.success && result.alreadyCheckedIn) {
        setTxError("Already checked in onchain today.");
        setOnchainDone(true);
        return;
      }

      setOnchainDone(true);
      const updatedStats: UserStats = {
        ...stats,
        zpoints: result.newTotal,
        currentStreak: result.newStreak,
        longestStreak: Math.max(stats.longestStreak, result.newStreak),
        // If free check-in was already done today, totalCheckIns already incremented — don't double-count
        totalCheckIns: freeDone ? stats.totalCheckIns : stats.totalCheckIns + 1,
        lastCheckIn: today,
        streakMultiplier: result.multiplier,
      };
      onCheckIn(updatedStats, {
        success: true,
        pointsEarned: result.pointsEarned,
        newTotal: result.newTotal,
        newStreak: result.newStreak,
        multiplier: result.multiplier,
        alreadyCheckedIn: false,
        message: result.message,
        feeZpoints: result.feeZpoints,
      });
    } catch (err) {
      console.error("Onchain check-in DB record failed:", err);
      setTxError("Tx confirmed but points recording failed. Contact support with tx hash.");
    } finally {
      setIsRecordingOnchain(false);
      resetTx();
    }
  }

  async function handleOnchainCheckIn() {
    if (onchainDone) return;
    setTxError(null);
    if (chain?.id !== base.id) {
      try { await switchChainAsync({ chainId: base.id }); }
      catch { setTxError("Please switch to Base network."); return; }
    }
    sendTransaction({ to: feeDestination, value: feeWei, chainId: base.id });
  }

  async function handleFreeCheckIn() {
    if (freeDone || isRecordingFree) return;
    setFreeError(null);
    setIsRecordingFree(true);
    try {
      const result = await dbCheckIn(
        stats.fid,
        stats.username,
        stats.displayName,
        stats.pfpUrl ?? undefined,
        undefined,  // no tx hash — free check-in
        "0",
        sessionDay,
        true        // freeMode
      );

      if (!result.success && result.alreadyFreeCheckedIn) {
        setFreeError("Already did free check-in today.");
        setFreeDone(true);
        return;
      }

      setFreeDone(true);
      const updatedStats: UserStats = {
        ...stats,
        zpoints: result.newTotal,
        currentStreak: result.newStreak,
        longestStreak: Math.max(stats.longestStreak, result.newStreak),
        totalCheckIns: stats.totalCheckIns + (result.alreadyCheckedIn ? 0 : 1),
        lastCheckIn: today,
        streakMultiplier: result.multiplier,
      };
      onCheckIn(updatedStats, {
        success: true,
        pointsEarned: result.pointsEarned,
        newTotal: result.newTotal,
        newStreak: result.newStreak,
        multiplier: result.multiplier,
        alreadyCheckedIn: false,
        message: result.message,
        feeZpoints: 0,
      });
    } catch (err) {
      console.error("Free check-in failed:", err);
      setFreeError("Free check-in failed. Try again.");
    } finally {
      setIsRecordingFree(false);
    }
  }

  function handleConnect() {
    const connector = connectors[0];
    if (connector) connect({ connector });
  }

  const isOnchainProcessing = isSending || isConfirming || isRecordingOnchain;
  const isLoading = !statusLoaded;

  return (
    <div className="mx-4 rounded-xl border border-[#00ff41]/20 bg-[#0a0a0a] p-5 space-y-4">

      {/* Streak + multiplier */}
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[10px] text-[#00ff41]/40 uppercase tracking-widest mb-1">Streak</p>
          <div className="flex items-end gap-2">
            <span className="font-mono text-5xl font-black text-[#00ff41] leading-none" style={{ textShadow: "0 0 12px #00ff41" }}>
              {stats.currentStreak}
            </span>
            <span className="font-mono text-sm text-[#00ff41]/60 mb-1">days</span>
          </div>
        </div>
        <div className="text-right space-y-1">
          <p className="font-mono text-[10px] text-[#00ff41]/40 uppercase tracking-widest">Today</p>
          <p className="font-mono text-sm font-black text-[#00ff41]">+{onchainPoints} ZP onchain</p>
          <p className="font-mono text-[10px] text-white/30">+{freePointsDisplay} ZP free</p>
        </div>
      </div>

      {/* Streak progress */}
      {nextMilestone && (
        <div>
          <div className="flex justify-between mb-1">
            <span className="font-mono text-[10px] text-[#00ff41]/40 uppercase tracking-widest">
              Next tier: {nextMilestone.days}d → {nextMilestone.multiplier}x
            </span>
            <span className="font-mono text-[10px] text-[#00ff41]/60">{nextMilestone.days - stats.currentStreak}d away</span>
          </div>
          <div className="h-1 bg-[#1a1a1a] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#00ff41] rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, (stats.currentStreak / nextMilestone.days) * 100)}%`, boxShadow: "0 0 6px #00ff41" }}
            />
          </div>
        </div>
      )}

      {/* Wallet pill */}
      {isConnected && address && (
        <div className="flex items-center justify-between bg-[#111] rounded-lg px-3 py-1.5 border border-[#00ff41]/10">
          <span className="font-mono text-[10px] text-white/30 uppercase tracking-widest">Wallet</span>
          <span className="font-mono text-[10px] text-[#00ff41]/70">{address.slice(0, 6)}…{address.slice(-4)}</span>
        </div>
      )}

      {/* ── Buttons side by side ── */}
      <div className="grid grid-cols-2 gap-2">

        {/* ONCHAIN — left, dominant */}
        <button
          onClick={isConnected ? handleOnchainCheckIn : handleConnect}
          disabled={isLoading || onchainDone || isOnchainProcessing}
          className={`
            flex flex-col items-center justify-center gap-1
            py-4 rounded-xl font-mono font-black tracking-widest uppercase
            transition-all duration-200 select-none min-h-[88px]
            ${onchainDone
              ? "bg-[#111] text-[#00ff41]/30 border border-[#00ff41]/10 cursor-not-allowed"
              : isOnchainProcessing
              ? "bg-[#00ff41]/20 text-[#00ff41] border border-[#00ff41]/40 cursor-wait"
              : !isConnected
              ? "bg-transparent text-[#00ff41] border border-[#00ff41]/60 hover:bg-[#00ff41]/10 hover:border-[#00ff41] active:scale-95"
              : "bg-[#00ff41] text-black border border-[#00ff41] hover:bg-[#39ff14] active:scale-95"
            }
          `}
          style={isConnected && !onchainDone && !isOnchainProcessing ? { boxShadow: "0 0 16px rgba(0,255,65,0.4)" } : {}}
        >
          {onchainDone ? (
            <>
              <span className="text-xs">✓ Onchain</span>
              <span className="text-[10px] font-normal">Done today</span>
            </>
          ) : isOnchainProcessing ? (
            <span className="text-xs animate-pulse">
              {isSending ? "Confirm..." : isConfirming ? "On-chain..." : "Recording..."}
            </span>
          ) : !isConnected ? (
            <>
              <span className="text-xs">Connect</span>
              <span className="text-[10px] font-normal opacity-80">to check in</span>
            </>
          ) : (
            <>
              <span className="text-xs">Onchain</span>
              <span className="text-[10px] font-normal">{feeDisplay}</span>
              <span className="text-sm font-black">+{onchainPoints} ZP</span>
            </>
          )}
        </button>

        {/* FREE — right, muted. Disabled only after freeDone or while recording */}
        <button
          onClick={handleFreeCheckIn}
          disabled={isLoading || freeDone || isOnchainProcessing || isRecordingFree}
          className={`
            flex flex-col items-center justify-center gap-1
            py-4 rounded-xl font-mono tracking-widest uppercase
            transition-all duration-200 select-none min-h-[88px]
            border bg-black/30
            ${freeDone
              ? "border-white/8 text-white/20 cursor-not-allowed opacity-40"
              : isOnchainProcessing || isRecordingFree
              ? "border-white/8 text-white/20 cursor-not-allowed opacity-30"
              : "border-white/15 text-white/50 hover:border-white/30 hover:text-white/70 active:scale-95"
            }
          `}
        >
          {freeDone ? (
            <>
              <span className="text-xs font-bold">✓ Free</span>
              <span className="text-[10px] opacity-70">Done today</span>
            </>
          ) : isRecordingFree ? (
            <span className="text-xs font-bold animate-pulse">Recording...</span>
          ) : (
            <>
              <span className="text-xs font-bold">Free</span>
              <span className="text-[10px] opacity-70">no wallet</span>
              <span className="text-[11px] font-black">+{freePointsDisplay} ZP</span>
            </>
          )}
        </button>
      </div>

      {/* Fee info */}
      {isConnected && !onchainDone && (
        <div className="flex items-center justify-between text-[10px] font-mono text-white/20">
          <span>Day {sessionDay} fee</span>
          <span>{feeDisplay} → {usesBank ? "ZorgBank" : "Liquidity"}</span>
        </div>
      )}

      {/* Errors */}
      {txError && (
        <p className="font-mono text-[10px] text-red-400/80 text-center leading-relaxed">{txError}</p>
      )}
      {freeError && (
        <p className="font-mono text-[10px] text-yellow-400/60 text-center leading-relaxed">{freeError}</p>
      )}

      {/* Tx hash */}
      {txHash && isTxConfirmed && (
        <p className="font-mono text-[10px] text-[#00ff41]/30 text-center truncate">
          tx: {txHash.slice(0, 10)}…{txHash.slice(-6)}
        </p>
      )}
    </div>
  );
}
