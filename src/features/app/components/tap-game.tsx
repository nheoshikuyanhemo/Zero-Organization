"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import {
  useAccount,
  useConnect,
  useSendTransaction,
  useWaitForTransactionReceipt,
  useSwitchChain,
} from "wagmi";
import { parseEther } from "viem";
import { base } from "viem/chains";
import { getTapGameState, recordTaps, activatePaidEnergy } from "@/db/actions/tap-actions";
import {
  FREE_TAPS_PER_CHARGE,
  PAID_TAPS_PER_CHARGE,
  FREE_ZP_PER_TAP,
  PAID_ZP_PER_TAP,
  FREE_ZP_MAX,
  PAID_ZP_MAX_PER_CHARGE,
  ENERGY_TOP_UP_ETH,
  UNITS_PER_ZP,
} from "@/features/app/lib/tap-config";
import { DEV_WALLET_ADDRESS } from "@/features/app/lib/zorg-config";
import { kvGet } from "@/neynar-db-sdk";

const BATCH_INTERVAL_MS = 800;

interface TapGameProps {
  fid: number;
  onPointsUpdate?: (newZpUnits: number, zpCredited: number) => void;
}

interface FloatLabel { id: number; x: number; y: number; paid: boolean; }

export function TapGame({ fid, onPointsUpdate }: TapGameProps) {
  // Server state
  const [freeEnergyUsed, setFreeEnergyUsed] = useState(0);
  const [paidEnergyCharges, setPaidEnergyCharges] = useState(0);
  const [paidEnergyUsed, setPaidEnergyUsed] = useState(0);
  const [tapZpUnits, setTapZpUnits] = useState(0); // accumulated ×10000
  const [loading, setLoading] = useState(true);
  const [tapping, setTapping] = useState(false);

  // Local tap buffer
  const pendingFreeRef = useRef(0);
  const pendingPaidRef = useRef(0);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapFlashRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [floats, setFloats] = useState<FloatLabel[]>([]);
  const floatIdRef = useRef(0);

  // Wallet — paid energy top-up
  const { isConnected, chain } = useAccount();
  const { connect, connectors } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const [feeDestination, setFeeDestination] = useState<`0x${string}`>(DEV_WALLET_ADDRESS as `0x${string}`);
  const { sendTransaction, data: txHash, isPending: isSending, reset: resetTx, error: sendError } = useSendTransaction();
  const { isLoading: isConfirming, isSuccess: isTxConfirmed, error: confirmError } = useWaitForTransactionReceipt({ hash: txHash });
  const [isActivating, setIsActivating] = useState(false);
  const [topUpError, setTopUpError] = useState<string | null>(null);
  const [topUpSuccess, setTopUpSuccess] = useState(false);
  const activatedTxRef = useRef<string | null>(null);

  useEffect(() => {
    kvGet("zorg:bank_address").then(addr => {
      if (addr?.startsWith("0x") && addr.length === 42) setFeeDestination(addr as `0x${string}`);
    });
  }, []);

  useEffect(() => { loadState(); }, [fid]);

  async function loadState() {
    setLoading(true);
    try {
      const s = await getTapGameState(fid);
      setFreeEnergyUsed(s.freeEnergyUsed);
      setPaidEnergyCharges(s.paidEnergyCharges);
      setPaidEnergyUsed(s.paidEnergyUsed);
      setTapZpUnits(s.tapZpUnits);
    } finally {
      setLoading(false);
    }
  }

  // Derived energy values
  const freeRemaining = Math.max(0, FREE_TAPS_PER_CHARGE - freeEnergyUsed);
  const paidTotal = paidEnergyCharges * PAID_TAPS_PER_CHARGE;
  const paidRemaining = Math.max(0, paidTotal - paidEnergyUsed);
  const hasEnergy = freeRemaining > 0 || paidRemaining > 0;
  const usePaid = freeRemaining === 0 && paidRemaining > 0;

  // ZP display: tapZpUnits / UNITS_PER_ZP
  const tapZpDisplay = (tapZpUnits / UNITS_PER_ZP).toFixed(4);
  const freeBarPct = FREE_TAPS_PER_CHARGE > 0 ? (freeRemaining / FREE_TAPS_PER_CHARGE) * 100 : 0;
  const paidBarPct = paidTotal > 0 ? (paidRemaining / paidTotal) * 100 : 0;

  const flushTaps = useCallback(async () => {
    const freeTaps = pendingFreeRef.current;
    const paidTaps = pendingPaidRef.current;
    pendingFreeRef.current = 0;
    pendingPaidRef.current = 0;

    if (freeTaps > 0) {
      const r = await recordTaps(fid, freeTaps, false);
      if (r.success) {
        setFreeEnergyUsed(prev => Math.min(FREE_TAPS_PER_CHARGE, prev + freeTaps));
        setTapZpUnits(r.newTapZpUnits);
        onPointsUpdate?.(r.newTapZpUnits, r.zpCredited);
      }
    }
    if (paidTaps > 0) {
      const r = await recordTaps(fid, paidTaps, true);
      if (r.success) {
        setPaidEnergyUsed(prev => prev + paidTaps);
        setTapZpUnits(r.newTapZpUnits);
        onPointsUpdate?.(r.newTapZpUnits, r.zpCredited);
      }
    }
  }, [fid, onPointsUpdate]);

  useEffect(() => {
    return () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      if (pendingFreeRef.current > 0 || pendingPaidRef.current > 0) flushTaps();
    };
  }, [flushTaps]);

  function handleTap(e: React.MouseEvent<HTMLButtonElement>) {
    if (!hasEnergy || loading) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Glow flash
    setTapping(true);
    if (tapFlashRef.current) clearTimeout(tapFlashRef.current);
    tapFlashRef.current = setTimeout(() => setTapping(false), 120);

    // Floating label
    const id = ++floatIdRef.current;
    const isPaid = usePaid;
    setFloats(prev => [...prev, { id, x, y, paid: isPaid }]);
    setTimeout(() => setFloats(prev => prev.filter(f => f.id !== id)), 700);

    // Buffer
    if (usePaid) {
      pendingPaidRef.current++;
      setPaidEnergyUsed(prev => prev + 1);
    } else {
      pendingFreeRef.current++;
      setFreeEnergyUsed(prev => Math.min(FREE_TAPS_PER_CHARGE, prev + 1));
    }

    // Optimistic ZP units update for display
    const unitsEarned = usePaid ? 1000 : 1;
    setTapZpUnits(prev => prev + unitsEarned);

    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(flushTaps, BATCH_INTERVAL_MS);
  }

  // Paid tx confirmed
  useEffect(() => {
    if (!isTxConfirmed || !txHash || isActivating) return;
    if (activatedTxRef.current === txHash) return;
    activatedTxRef.current = txHash;
    handleActivatePaid(txHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTxConfirmed, txHash]);

  useEffect(() => {
    if (!sendError) return;
    const msg = sendError.message ?? "";
    if (!msg.toLowerCase().includes("rejected") && !msg.toLowerCase().includes("denied") && !msg.toLowerCase().includes("user")) {
      setTopUpError("Transaction failed. Ensure wallet has ETH on Base.");
    }
    resetTx();
  }, [sendError, resetTx]);

  useEffect(() => {
    if (!confirmError) return;
    setTopUpError("Transaction failed to confirm. Try again.");
    resetTx();
  }, [confirmError, resetTx]);

  async function handleActivatePaid(confirmedTx: string) {
    setIsActivating(true);
    try {
      const result = await activatePaidEnergy(fid, confirmedTx);
      if (result.success) {
        setPaidEnergyCharges(prev => prev + 1);
        setTopUpSuccess(true);
        setTimeout(() => setTopUpSuccess(false), 3000);
      } else {
        setTopUpError(result.error ?? "Activation failed");
      }
    } finally {
      setIsActivating(false);
      resetTx();
    }
  }

  async function handleTopUp() {
    setTopUpError(null);
    if (!isConnected) { const c = connectors[0]; if (c) connect({ connector: c }); return; }
    if (chain?.id !== base.id) {
      try { await switchChainAsync({ chainId: base.id }); }
      catch { setTopUpError("Switch to Base network."); return; }
    }
    sendTransaction({ to: feeDestination, value: parseEther(ENERGY_TOP_UP_ETH), chainId: base.id });
  }

  if (loading) return (
    <div className="mx-4 rounded-xl border border-[#00ff41]/15 bg-[#050505] p-6 flex items-center justify-center">
      <p className="font-mono text-[10px] text-[#00ff41]/30 animate-pulse tracking-widest">LOADING TAP...</p>
    </div>
  );

  return (
    <div className="mx-4 rounded-xl border border-[#00ff41]/15 bg-[#050505] p-4 space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[10px] text-[#00ff41]/40 uppercase tracking-widest">Tap to Earn</p>
          <p className="font-mono text-[10px] text-white/25 mt-0.5">
            free: {FREE_ZP_PER_TAP} ZP/tap &nbsp;·&nbsp; paid: {PAID_ZP_PER_TAP} ZP/tap
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-sm font-black text-[#00ff41]" style={{ textShadow: "0 0 8px #00ff41" }}>
            {tapZpDisplay} ZP
          </p>
          <p className="font-mono text-[10px] text-white/20">tap total</p>
        </div>
      </div>

      {/* Energy bars */}
      <div className="space-y-2">
        <div>
          <div className="flex justify-between mb-1">
            <span className="font-mono text-[10px] text-white/40">
              Free energy &nbsp;<span className="text-white/20">· {FREE_ZP_MAX} ZP max</span>
            </span>
            <span className="font-mono text-[10px] text-white/30">
              {freeRemaining.toLocaleString()} / {FREE_TAPS_PER_CHARGE.toLocaleString()} taps
            </span>
          </div>
          <div className="h-2 bg-[#1a1a1a] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-200"
              style={{
                width: `${freeBarPct}%`,
                background: freeBarPct > 20 ? "#00ff41" : "#ff4444",
                boxShadow: freeBarPct > 0 ? "0 0 4px #00ff41" : "none",
              }}
            />
          </div>
        </div>
        {paidTotal > 0 && (
          <div>
            <div className="flex justify-between mb-1">
              <span className="font-mono text-[10px] text-purple-400/60">
                Paid energy &nbsp;<span className="text-purple-400/30">· {PAID_ZP_MAX_PER_CHARGE} ZP max</span>
              </span>
              <span className="font-mono text-[10px] text-purple-400/40">
                {paidRemaining.toLocaleString()} / {paidTotal.toLocaleString()} taps
              </span>
            </div>
            <div className="h-2 bg-[#1a1a1a] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-200"
                style={{ width: `${paidBarPct}%`, background: "#a855f7", boxShadow: "0 0 4px #a855f7" }}
              />
            </div>
          </div>
        )}
      </div>

      {/* BIG LOGO TAP BUTTON */}
      <div className="flex justify-center py-2">
        <button
          onClick={handleTap}
          disabled={!hasEnergy}
          className="relative select-none active:scale-95 transition-transform duration-75 disabled:cursor-not-allowed"
          style={{ WebkitTapHighlightColor: "transparent" }}
        >
          {/* Tap burst glow */}
          {tapping && (
            <span
              className="absolute inset-0 pointer-events-none rounded-full"
              style={{
                background: usePaid
                  ? "radial-gradient(circle, rgba(168,85,247,0.5) 0%, transparent 70%)"
                  : "radial-gradient(circle, rgba(0,255,65,0.5) 0%, transparent 70%)",
                transform: "scale(1.8)",
                animation: "none",
              }}
            />
          )}
          {/* Ambient glow */}
          {hasEnergy && !tapping && (
            <span
              className="absolute inset-0 pointer-events-none rounded-full"
              style={{
                background: usePaid
                  ? "radial-gradient(circle, rgba(168,85,247,0.1) 0%, transparent 65%)"
                  : "radial-gradient(circle, rgba(0,255,65,0.1) 0%, transparent 65%)",
                transform: "scale(1.5)",
              }}
            />
          )}

          {/* Logo */}
          <div
            className="relative rounded-full overflow-hidden"
            style={{
              width: 128,
              height: 128,
              filter: !hasEnergy
                ? "grayscale(100%) brightness(0.25)"
                : tapping
                ? usePaid
                  ? "brightness(1.5) drop-shadow(0 0 20px #a855f7) drop-shadow(0 0 40px #a855f7)"
                  : "brightness(1.5) drop-shadow(0 0 20px #00ff41) drop-shadow(0 0 40px #00ff41)"
                : usePaid
                ? "brightness(1.05) drop-shadow(0 0 8px rgba(168,85,247,0.7))"
                : "brightness(1.05) drop-shadow(0 0 8px rgba(0,255,65,0.7))",
              transition: "filter 0.08s ease",
            }}
          >
            <Image
              src="/app-logo.png"
              alt="ZORG — tap to earn"
              width={128}
              height={128}
              className="object-cover w-full h-full select-none"
              draggable={false}
              priority
            />
          </div>

          {/* Empty overlay */}
          {!hasEnergy && (
            <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/70">
              <span className="font-mono text-[10px] text-white/40 uppercase tracking-widest">empty</span>
            </div>
          )}

          {/* Floating +ZP labels */}
          {floats.map(f => (
            <span
              key={f.id}
              className="absolute pointer-events-none font-mono text-xs font-black select-none"
              style={{
                left: f.x,
                top: f.y,
                transform: "translate(-50%, -100%)",
                color: f.paid ? "#a855f7" : "#00ff41",
                textShadow: f.paid ? "0 0 8px #a855f7" : "0 0 8px #00ff41",
                animation: "zpFloat 0.7s ease-out forwards",
              }}
            >
              +{f.paid ? PAID_ZP_PER_TAP : FREE_ZP_PER_TAP}
            </span>
          ))}
        </button>
      </div>

      {/* Status hint */}
      <p className="font-mono text-[10px] text-white/20 text-center leading-relaxed">
        {!hasEnergy
          ? "Energy empty · free resets at midnight UTC · or top up below"
          : usePaid
          ? `Paid ⚡ active — +${PAID_ZP_PER_TAP} ZP per tap — ${paidRemaining.toLocaleString()} taps left`
          : `+${FREE_ZP_PER_TAP} ZP per tap · ${freeRemaining.toLocaleString()} free taps remaining today`
        }
      </p>

      {/* Top-up */}
      <div className="space-y-1.5">
        <button
          onClick={handleTopUp}
          disabled={isSending || isConfirming || isActivating}
          className={`
            w-full py-3 rounded-xl font-mono text-xs font-bold tracking-widest uppercase
            transition-all select-none min-h-[48px] active:scale-95
            border border-purple-400/30 bg-purple-900/15 text-purple-300/80
            hover:bg-purple-900/30 hover:border-purple-400/50 hover:text-purple-300
            disabled:opacity-40 disabled:cursor-wait
          `}
          style={{ boxShadow: "0 0 8px rgba(168,85,247,0.08)" }}
        >
          {isActivating ? "Activating..." : isConfirming ? "Confirming on-chain..." : isSending ? "Confirm in wallet..." : `⚡ Buy Paid Energy — ${ENERGY_TOP_UP_ETH} ETH`}
        </button>
        <p className="font-mono text-[10px] text-white/15 text-center">
          {PAID_TAPS_PER_CHARGE.toLocaleString()} taps · {PAID_ZP_MAX_PER_CHARGE} ZP max · {PAID_ZP_PER_TAP} ZP/tap · Base chain
        </p>
      </div>

      {topUpSuccess && (
        <p className="font-mono text-[10px] text-purple-300 text-center bg-purple-900/20 rounded-lg py-2 border border-purple-400/20">
          ⚡ Paid energy activated — {PAID_TAPS_PER_CHARGE.toLocaleString()} taps added
        </p>
      )}
      {topUpError && (
        <p className="font-mono text-[10px] text-red-400/70 text-center">{topUpError}</p>
      )}

      {/* Keyframe */}
      <style>{`
        @keyframes zpFloat {
          0%   { opacity: 1; transform: translate(-50%, -100%); }
          100% { opacity: 0; transform: translate(-50%, -260%); }
        }
      `}</style>
    </div>
  );
}
