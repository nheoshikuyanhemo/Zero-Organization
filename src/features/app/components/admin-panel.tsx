"use client";

import { useState, useEffect } from "react";
import { useReadContract } from "wagmi";
import { formatEther } from "viem";
import { kvGet } from "@/neynar-db-sdk";
import { getSessionInfo, endSessionNow } from "@/db/actions/session-actions";
import { getGlobalTotalZpoints, getTotalFeesCollected, getTotalEthCollected } from "@/db/actions/user-stats-actions";
import { BANK_ABI } from "@/features/app/lib/bank-abi";
import { notifySessionEnd, notifyCustomAnnouncement } from "@/db/actions/notification-actions";
import {
  DEV_WALLET_ADDRESS,
  USER_ALLOC_BPS,
  LIQUIDITY_ALLOC_BPS,
  DEV_ALLOC_BPS,
  USER_TOKEN_POOL,
  LIQUIDITY_TOKEN_POOL,
  DEV_TOKEN_AMOUNT,
} from "@/features/app/lib/zorg-config";
import { DeployContractsPanel } from "./deploy-contracts-panel";
import { BankDeployPanel } from "./bank-deploy-panel";

interface AdminStats {
  totalZpoints: number;
  totalFees: number;
  totalEthCollectedDb: number;
  daysElapsed: number;
  daysRemaining: number;
  isEnded: boolean;
  tokenAddress: string | null;
}

export function AdminPanel({ currentFid }: { currentFid: number }) {
  const creatorFid = Number(process.env.NEXT_PUBLIC_USER_FID ?? 0);
  const isAdmin = currentFid === creatorFid;

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [notifyStatus, setNotifyStatus] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [customBody, setCustomBody] = useState("");
  const [bankAddress, setBankAddress] = useState<string | null>(null);
  const [endSessionStatus, setEndSessionStatus] = useState("");
  const [endSessionConfirm, setEndSessionConfirm] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    loadStats();
  }, [isAdmin]);

  async function loadStats() {
    try {
      const [session, globalZp, fees, ethCollected, tokenAddr, bankAddr] = await Promise.all([
        getSessionInfo(),
        getGlobalTotalZpoints(),
        getTotalFeesCollected(),
        getTotalEthCollected(),
        kvGet("zorg:token_address"),
        kvGet("zorg:bank_address"),
      ]);
      setStats({
        totalZpoints: globalZp,
        totalFees: fees,
        totalEthCollectedDb: ethCollected,
        daysElapsed: session.daysElapsed,
        daysRemaining: session.daysRemaining,
        isEnded: session.isEnded,
        tokenAddress: tokenAddr,
      });
      setBankAddress(bankAddr);
    } finally {
      setLoading(false);
    }
  }

  async function handleEndSession() {
    if (!endSessionConfirm) {
      setEndSessionConfirm(true);
      setEndSessionStatus("Click again to confirm — this ends the session immediately.");
      return;
    }
    setEndSessionStatus("Ending session...");
    setEndSessionConfirm(false);
    try {
      const result = await endSessionNow(currentFid);
      if (result.success) {
        setEndSessionStatus("Session ended. Distribution is now unlocked.");
        await loadStats();
      } else {
        setEndSessionStatus(`Error: ${result.error}`);
      }
    } catch (err) {
      setEndSessionStatus(`Error: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  async function handleNotifySessionEnd() {
    setNotifyStatus("Sending...");
    try {
      const result = await notifySessionEnd();
      setNotifyStatus(result.success ? "Sent to all subscribers!" : `Error: ${result.error}`);
    } catch (err) {
      setNotifyStatus(`Error: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  async function handleCustomNotify() {
    if (!customTitle.trim() || !customBody.trim()) {
      setNotifyStatus("Title and body are required."); return;
    }
    setNotifyStatus("Sending...");
    try {
      const result = await notifyCustomAnnouncement(customTitle.trim(), customBody.trim());
      if (result.success) {
        setNotifyStatus("Announcement sent!");
        setCustomTitle(""); setCustomBody("");
      } else {
        setNotifyStatus(`Error: ${result.error}`);
      }
    } catch (err) {
      setNotifyStatus(`Error: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  // Live ETH balance from ZorgBank — real-time, refreshes every 15s
  const { data: bankEthRaw } = useReadContract({
    address: bankAddress ? (bankAddress as `0x${string}`) : undefined,
    abi: BANK_ABI,
    functionName: "ethBalance",
    query: { enabled: !!bankAddress, refetchInterval: 15_000 },
  });

  const ethCollected = bankEthRaw !== undefined
    ? parseFloat(formatEther(bankEthRaw as bigint))
    : (stats?.totalEthCollectedDb ?? 0);

  const ethLabel = bankAddress ? "ETH in Bank" : "ETH Collected";
  const ethSub = bankAddress ? "ZorgBank · live" : "→ Liquidity · Base";

  if (!isAdmin) return (
    <div className="mx-4 mt-6 rounded-xl border border-red-500/20 bg-[#0a0a0a] p-6 text-center">
      <p className="font-mono text-sm text-red-400">Access denied.</p>
    </div>
  );

  if (loading) return (
    <div className="flex items-center justify-center py-12">
      <p className="font-mono text-xs text-[#00ff41]/40 animate-pulse tracking-widest">LOADING...</p>
    </div>
  );

  return (
    <div className="px-4 pb-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] text-red-400/70 uppercase tracking-widest bg-red-400/10 px-2 py-0.5 rounded">ADMIN</span>
        <span className="font-mono text-[10px] text-[#00ff41]/30 uppercase tracking-widest">ZORG Control Panel</span>
      </div>

      {/* Live stats */}
      <div className="rounded-xl border border-[#00ff41]/20 bg-[#0a0a0a] p-4 grid grid-cols-2 gap-3">
        {[
          { label: "Global ZP", value: stats?.totalZpoints.toLocaleString() ?? "0", sub: null, highlight: false },
          { label: ethLabel, value: `${ethCollected.toFixed(6)} ETH`, sub: ethSub, highlight: true },
          { label: "Zpoint Fees", value: `${stats?.totalFees.toLocaleString() ?? "0"} ZP`, sub: "0.1% per check-in", highlight: false },
          { label: "Day", value: `${stats?.daysElapsed ?? 0} / 100`, sub: stats?.isEnded ? "Session complete" : `${stats?.daysRemaining}d remaining`, highlight: false },
        ].map((s) => (
          <div key={s.label}>
            <p className="font-mono text-[10px] text-[#00ff41]/40 uppercase tracking-widest">{s.label}</p>
            <p className={`font-mono text-base font-black ${s.highlight ? "text-[#00ff41]" : "text-white"}`}
              style={s.highlight ? { textShadow: "0 0 8px #00ff41" } : undefined}>
              {s.value}
            </p>
            {s.sub && <p className="font-mono text-[10px] text-white/25 mt-0.5">{s.sub}</p>}
          </div>
        ))}
      </div>

      {/* Tokenomics summary */}
      <div className="rounded-xl border border-[#00ff41]/20 bg-[#0a0a0a] p-4 space-y-2">
        <p className="font-mono text-[10px] text-[#00ff41]/40 uppercase tracking-widest mb-1">Token Allocation</p>
        {[
          { label: "Users (70%)", amount: Number(USER_TOKEN_POOL).toLocaleString(), bps: USER_ALLOC_BPS },
          { label: "Liquidity (25%)", amount: Number(LIQUIDITY_TOKEN_POOL).toLocaleString(), bps: LIQUIDITY_ALLOC_BPS },
          { label: "Dev (5%)", amount: Number(DEV_TOKEN_AMOUNT).toLocaleString(), bps: DEV_ALLOC_BPS },
        ].map((t) => (
          <div key={t.label} className="flex justify-between items-center">
            <span className="font-mono text-xs text-white/60">{t.label}</span>
            <span className="font-mono text-xs font-bold text-[#00ff41]">{t.amount} ZORG</span>
          </div>
        ))}
        <div className="flex rounded overflow-hidden h-2 gap-px mt-2">
          <div style={{ width: "70%", background: "#00ff41" }} />
          <div style={{ width: "25%", background: "#00ffaa" }} />
          <div style={{ width: "5%", background: "#39ff14" }} />
        </div>
      </div>

      {/* ZorgBank vault */}
      <div className="rounded-xl border border-purple-400/20 bg-[#0a0a0a] p-4 space-y-3">
        <p className="font-mono text-[10px] text-purple-400/60 uppercase tracking-widest">Step 0 — Deploy Vault</p>
        <BankDeployPanel currentFid={currentFid} onRefresh={loadStats} />
      </div>

      {/* Fee destination callout */}
      {bankAddress && (
        <div className="rounded-xl border border-purple-400/10 bg-[#0a0a0a] p-3 space-y-1">
          <p className="font-mono text-[10px] text-purple-400/40 uppercase tracking-widest">Check-in Fee Destination</p>
          <p className="font-mono text-[9px] text-white/30 leading-relaxed">
            All check-in ETH fees are sent directly to the ZorgBank contract address below.
          </p>
          <p className="font-mono text-[9px] text-purple-300 break-all">{bankAddress}</p>
        </div>
      )}

      {/* End Session — admin-controlled */}
      <div className="rounded-xl border border-yellow-400/20 bg-[#0a0a0a] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="font-mono text-[10px] text-yellow-400/60 uppercase tracking-widest">Session Control</p>
          {stats?.isEnded && (
            <span className="font-mono text-[9px] text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 px-2 py-0.5 rounded">ENDED</span>
          )}
        </div>
        <p className="font-mono text-[9px] text-white/30 leading-relaxed">
          End the session at any time to unlock distribution. Once ended, no new check-ins affect the token allocation snapshot.
        </p>
        {stats?.isEnded ? (
          <div className="flex items-center gap-2 py-2">
            <span className="text-yellow-400 text-sm">✓</span>
            <span className="font-mono text-xs text-yellow-400/70">Session has ended — distribution is unlocked</span>
          </div>
        ) : (
          <button
            onClick={handleEndSession}
            disabled={endSessionStatus === "Ending session..."}
            className={`w-full py-3 rounded-lg font-mono text-xs font-bold tracking-widest uppercase transition-all min-h-[44px] active:scale-95 disabled:cursor-not-allowed ${
              endSessionConfirm
                ? "bg-yellow-400 text-black"
                : "bg-yellow-400/10 border border-yellow-400/30 text-yellow-400 hover:bg-yellow-400/20"
            }`}
          >
            {endSessionStatus === "Ending session..."
              ? "Ending..."
              : endSessionConfirm
              ? "Confirm — End Session Now"
              : "End Session"}
          </button>
        )}
        {endSessionStatus && endSessionStatus !== "Ending session..." && (
          <p className={`font-mono text-[9px] px-3 py-2 rounded leading-relaxed ${
            endSessionStatus.startsWith("Error")
              ? "text-red-400/80 bg-red-400/5"
              : endSessionConfirm
              ? "text-yellow-400/80 bg-yellow-400/5"
              : "text-[#00ff41]/70 bg-[#00ff41]/5"
          }`}>{endSessionStatus}</p>
        )}
      </div>

      {/* Deploy & Distribution pipeline */}
      <div className="rounded-xl border border-[#00ff41]/20 bg-[#0a0a0a] p-4 space-y-3">
        <p className="font-mono text-[10px] text-[#00ff41]/40 uppercase tracking-widest">Deploy & Distribution Pipeline</p>
        <DeployContractsPanel
          currentFid={currentFid}
          onRefresh={loadStats}
        />
      </div>

      {/* Notifications */}
      <div className="rounded-xl border border-[#00ff41]/20 bg-[#0a0a0a] p-4 space-y-3">
        <p className="font-mono text-[10px] text-[#00ff41]/40 uppercase tracking-widest">Push Notifications</p>
        <p className="font-mono text-xs text-white/40 leading-relaxed">
          Broadcast to all ZORG subscribers on Farcaster. Users must tap <span className="text-white/60">"Allow Notifications"</span> when opening the app to subscribe.
        </p>
        <button
          onClick={handleNotifySessionEnd}
          disabled={notifyStatus === "Sending..."}
          className={`w-full py-3 rounded-lg font-mono text-xs font-bold tracking-widest uppercase transition-all min-h-[44px] ${
            notifyStatus === "Sending..."
              ? "bg-[#00ff41]/20 text-[#00ff41] border border-[#00ff41]/30 cursor-wait"
              : "bg-[#00ff41]/10 border border-[#00ff41]/30 text-[#00ff41] hover:bg-[#00ff41]/20 active:scale-95"
          }`}
        >
          {notifyStatus === "Sending..." ? "Sending..." : "Notify: Session Ended + Distributing"}
        </button>
        <div className="space-y-2 pt-2 border-t border-[#00ff41]/10">
          <p className="font-mono text-[10px] text-white/30">Custom announcement:</p>
          <input
            value={customTitle}
            onChange={(e) => setCustomTitle(e.target.value)}
            placeholder="Title (max 32 chars)"
            maxLength={32}
            className="w-full bg-[#111] border border-[#00ff41]/20 rounded px-3 py-2 font-mono text-xs text-white focus:outline-none focus:border-[#00ff41]/60 min-h-[44px]"
          />
          <input
            value={customBody}
            onChange={(e) => setCustomBody(e.target.value)}
            placeholder="Body (max 128 chars)"
            maxLength={128}
            className="w-full bg-[#111] border border-[#00ff41]/20 rounded px-3 py-2 font-mono text-xs text-white focus:outline-none focus:border-[#00ff41]/60 min-h-[44px]"
          />
          <button
            onClick={handleCustomNotify}
            disabled={notifyStatus === "Sending..." || !customTitle.trim() || !customBody.trim()}
            className="w-full py-2 rounded-lg font-mono text-xs font-bold tracking-widest uppercase border border-[#00ff41]/30 text-[#00ff41] hover:bg-[#00ff41]/10 transition-all min-h-[44px] disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Send Custom Announcement
          </button>
        </div>
        {notifyStatus && notifyStatus !== "Sending..." && (
          <p className={`font-mono text-[10px] px-3 py-2 rounded leading-relaxed ${
            notifyStatus.startsWith("Error") && notifyStatus.includes("No subscribers")
              ? "text-white/40 bg-white/5"
              : notifyStatus.startsWith("Error")
              ? "text-red-400 bg-red-400/5"
              : "text-[#00ff41]/70 bg-[#00ff41]/5"
          }`}>{notifyStatus}</p>
        )}
      </div>

      {/* Dev wallet */}
      <div className="rounded-xl border border-[#00ff41]/10 bg-[#0a0a0a] p-3">
        <p className="font-mono text-[10px] text-[#00ff41]/30 uppercase tracking-widest mb-1">Dev / Fee Wallet · Base</p>
        <p className="font-mono text-[10px] text-white/40 break-all">{DEV_WALLET_ADDRESS}</p>
      </div>
    </div>
  );
}
