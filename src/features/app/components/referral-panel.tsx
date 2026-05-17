"use client";

import { useState, useEffect } from "react";
import sdk from "@farcaster/miniapp-sdk";
import { getReferralStats } from "@/db/actions/referral-actions";

interface ReferralPanelProps {
  fid: number;
  username: string;
}

interface ReferralStats {
  referralCode: string;
  totalReferrals: number;
  totalBonusEarned: number;
  myReferrerUsername: string | null;
}

export function ReferralPanel({ fid, username }: ReferralPanelProps) {
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    getReferralStats(fid)
      .then(setStats)
      .finally(() => setLoading(false));
  }, [fid]);

  // The app's public URL — use the canonical deployed URL, not window.location
  // so the link works as a Farcaster frame embed everywhere
  const appBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (typeof window !== "undefined" ? window.location.origin : "");

  const referralUrl = stats ? `${appBaseUrl}?ref=${stats.referralCode}` : "";

  async function handleCopy() {
    if (!referralUrl) return;
    try {
      await navigator.clipboard.writeText(referralUrl);
    } catch {
      // Clipboard API not available — silent fail, share button is the primary CTA
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleShare() {
    if (!stats || sharing) return;
    setSharing(true);
    try {
      // Use Farcaster SDK composeCast — opens the cast composer in the client
      // with the referral link embedded. This is the correct way to share inside
      // the Farcaster ecosystem so the ?ref= param is preserved in the frame URL.
      // Ensure the URL uses https for the Farcaster embed requirement
      const embedUrl = referralUrl.replace(/^http:\/\//, "https://");
      await sdk.actions.composeCast({
        text: `Earning Zpoints on ZORG — zero org, maximum points. Use my invite link to join and we both earn more 👾\n\n${embedUrl}`,
        embeds: [embedUrl as `https://${string}`],
      });
    } catch (err) {
      // composeCast may not be supported in all clients — fall back to copy
      await handleCopy();
    } finally {
      setSharing(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-4 rounded-xl border border-[#00ff41]/20 bg-[#0a0a0a] p-10 flex items-center justify-center">
        <p className="font-mono text-[10px] text-[#00ff41]/30 animate-pulse tracking-widest">LOADING...</p>
      </div>
    );
  }

  return (
    <div className="mx-4 space-y-3">

      {/* Stats card */}
      <div className="rounded-xl border border-[#00ff41]/20 bg-[#0a0a0a] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="font-mono text-[10px] text-[#00ff41]/40 uppercase tracking-widest">Referral Program</p>
          <span className="font-mono text-[10px] text-[#00ff41]/50">@{username}</span>
        </div>

        {/* Counters */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-[#0d0d0d] border border-[#00ff41]/10 p-4 text-center">
            <p
              className="font-mono text-4xl font-black text-[#00ff41] leading-none"
              style={{ textShadow: "0 0 12px #00ff41" }}
            >
              {stats?.totalReferrals ?? 0}
            </p>
            <p className="font-mono text-[10px] text-white/30 uppercase tracking-widest mt-2">Invited</p>
          </div>
          <div className="rounded-lg bg-[#0d0d0d] border border-[#00ff41]/10 p-4 text-center">
            <p
              className="font-mono text-4xl font-black text-[#00ff41] leading-none"
              style={{ textShadow: "0 0 12px #00ff41" }}
            >
              {stats?.totalBonusEarned ?? 0}
            </p>
            <p className="font-mono text-[10px] text-white/30 uppercase tracking-widest mt-2">Bonus ZP</p>
          </div>
        </div>

        {/* Rules */}
        <div className="space-y-2 border-t border-white/5 pt-3">
          {[
            { label: "+10 ZP", text: "instantly when someone joins via your link" },
            { label: "+25%",   text: "bonus on every onchain check-in they do" },
            { label: "100%",   text: "of their ZP stays with them — you earn on top" },
          ].map((r, i) => (
            <div key={i} className="flex items-start gap-3">
              <span
                className="font-mono text-xs font-black text-[#00ff41] w-12 text-right shrink-0 pt-0.5"
                style={{ textShadow: "0 0 6px #00ff41" }}
              >
                {r.label}
              </span>
              <p className="font-mono text-[10px] text-white/40 leading-relaxed">{r.text}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Share card */}
      <div className="rounded-xl border border-[#00ff41]/20 bg-[#0a0a0a] p-4 space-y-3">
        <p className="font-mono text-[10px] text-[#00ff41]/40 uppercase tracking-widest">Your Invite Link</p>

        {/* Code badge */}
        <div className="flex items-center justify-between bg-[#0d0d0d] border border-[#00ff41]/10 rounded-lg px-3 py-2.5">
          <span className="font-mono text-[10px] text-white/25 uppercase tracking-widest">Code</span>
          <span
            className="font-mono text-base font-black text-[#00ff41] tracking-[0.15em]"
            style={{ textShadow: "0 0 8px #00ff41" }}
          >
            {stats?.referralCode ?? "—"}
          </span>
        </div>

        {/* URL */}
        <div className="bg-[#0d0d0d] border border-white/5 rounded-lg px-3 py-2">
          <p className="font-mono text-[10px] text-white/30 break-all leading-relaxed">{referralUrl || "—"}</p>
        </div>

        {/* Primary: Share as Farcaster cast */}
        <button
          onClick={handleShare}
          disabled={sharing || !stats}
          className={`
            w-full py-3.5 rounded-xl font-mono text-xs font-black tracking-widest uppercase
            transition-all duration-150 select-none min-h-[52px] active:scale-95
            bg-[#00ff41] text-black hover:bg-[#39ff14]
            disabled:opacity-50 disabled:cursor-wait
          `}
          style={{ boxShadow: "0 0 14px rgba(0,255,65,0.3)" }}
        >
          {sharing ? "Opening..." : "Share on Farcaster"}
        </button>

        {/* Secondary: copy raw URL */}
        <button
          onClick={handleCopy}
          disabled={!stats}
          className={`
            w-full py-2.5 rounded-xl font-mono text-xs tracking-widest uppercase
            transition-all duration-150 select-none active:scale-95
            border text-[#00ff41]/60 hover:text-[#00ff41]
            ${copied
              ? "border-[#00ff41]/40 bg-[#00ff41]/10 text-[#00ff41]"
              : "border-[#00ff41]/20 bg-transparent hover:border-[#00ff41]/40"
            }
          `}
        >
          {copied ? "✓ Link Copied" : "Copy Link"}
        </button>
      </div>

      {/* Referred-by */}
      {stats?.myReferrerUsername && (
        <div className="rounded-xl border border-white/5 bg-[#0a0a0a] px-4 py-3 flex items-center justify-between">
          <span className="font-mono text-[10px] text-white/20 uppercase tracking-widest">Referred by</span>
          <span className="font-mono text-xs text-[#00ff41]/50">@{stats.myReferrerUsername}</span>
        </div>
      )}

      <div className="pb-4" />
    </div>
  );
}
