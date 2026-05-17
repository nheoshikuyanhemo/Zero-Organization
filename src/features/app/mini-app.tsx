"use client";

import { useState, useEffect } from "react";
import sdk from "@farcaster/miniapp-sdk";
import { useFarcasterUser, ShareButton } from "@/neynar-farcaster-sdk/mini";
import { UserStats, CheckInResult, SessionInfo, AppView } from "./types";
import { getOrCreateUserStats, getGlobalTotalZpoints, runWelcomeBonusBackfill } from "@/db/actions/user-stats-actions";
import { getSessionInfo } from "@/db/actions/session-actions";
import { getTapGameState } from "@/db/actions/tap-actions";
import { ZorgHeader } from "./components/zorg-header";
import { CheckInCard } from "./components/check-in-card";
import { StatsGrid } from "./components/stats-grid";
import { NavTabs } from "./components/nav-tabs";
import { CheckInToast } from "./components/checkin-toast";
import { SessionBanner } from "./components/session-banner";
import { AboutPanel } from "./components/about-panel";
import { Leaderboard } from "./components/leaderboard";
import { AdminPanel } from "./components/admin-panel";
import { StatsPage } from "./components/stats-page";
import { TapGame } from "./components/tap-game";
import { ReferralPanel } from "./components/referral-panel";

export function MiniApp() {
  const { data: user } = useFarcasterUser();
  const [stats, setStats] = useState<UserStats | null>(null);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [totalGlobalZpoints, setTotalGlobalZpoints] = useState(0);
  const [activeView, setActiveView] = useState<AppView>("home");
  const [lastResult, setLastResult] = useState<CheckInResult | null>(null);
  const [loading, setLoading] = useState(true);
  // Live fractional tap ZP units (×10000) — visible in header and stats before whole-ZP threshold
  const [tapZpUnits, setTapZpUnits] = useState(0);

  useEffect(() => {
    if (!user) return;

    async function loadData() {
      try {
        // Pick up referral code from URL — only matters on very first sign-up
        const refCode = typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("ref") ?? undefined
          : undefined;

        // Run backfill in background — fire and forget, never blocks load
        runWelcomeBonusBackfill().catch(() => {});

        const [dbStats, session, globalZp, tapState] = await Promise.all([
          getOrCreateUserStats(
            user!.fid,
            user!.username ?? `fid:${user!.fid}`,
            user!.displayName ?? user!.username ?? `fid:${user!.fid}`,
            user!.pfpUrl,
            refCode
          ),
          getSessionInfo(),
          getGlobalTotalZpoints(),
          getTapGameState(user!.fid),
        ]);

        setStats({
          fid: dbStats.fid,
          username: dbStats.username,
          displayName: dbStats.displayName,
          pfpUrl: dbStats.pfpUrl,
          zpoints: dbStats.zpoints,
          currentStreak: dbStats.currentStreak,
          longestStreak: dbStats.longestStreak,
          totalCheckIns: dbStats.totalCheckIns,
          lastCheckIn: dbStats.lastCheckIn,
          streakMultiplier: dbStats.streakMultiplier,
        });

        setSessionInfo({
          daysElapsed: session.daysElapsed,
          daysRemaining: session.daysRemaining,
          progressPct: session.progressPct,
          isEnded: session.isEnded,
          totalZpoints: session.session.totalZpoints,
          endsAt: session.endsAt.toISOString(),
        });

        setTotalGlobalZpoints(globalZp);
        // Seed fractional tap ZP — carry-over units not yet crossed the 1 ZP threshold
        setTapZpUnits(tapState.tapZpUnits % 10_000);
      } catch (err) {
        console.error("Failed to load ZORG data:", err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [user]);

  function handleCheckIn(updatedStats: UserStats, result: CheckInResult) {
    setStats(updatedStats);
    setLastResult(result);
    // Refresh global total after check-in
    getGlobalTotalZpoints().then(setTotalGlobalZpoints);
  }

  return (
    <div className="h-dvh flex flex-col bg-black overflow-hidden">
      {/* Scanline overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-10 opacity-[0.03]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,65,1) 2px, rgba(0,255,65,1) 4px)",
        }}
      />

      {/* Toast */}
      <CheckInToast result={lastResult} onDismiss={() => setLastResult(null)} />

      {/* Header */}
      <ZorgHeader stats={stats} tapZpUnits={tapZpUnits} />

      {/* Nav */}
      <div className="py-3">
        <NavTabs
          activeView={activeView}
          onViewChange={setActiveView}
          isAdmin={user?.fid === Number(process.env.NEXT_PUBLIC_USER_FID ?? 0)}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {!user ? (
          <NotConnectedState />
        ) : loading ? (
          <LoadingState />
        ) : activeView === "home" ? (
          <div className="space-y-3 pb-4">
            <SessionBanner
              session={sessionInfo}
              userZpoints={stats?.zpoints ?? 0}
            />
            {stats && (
              <CheckInCard
                stats={stats}
                sessionDay={Math.max(1, (sessionInfo?.daysElapsed ?? 0) + 1)}
                onCheckIn={handleCheckIn}
              />
            )}
            {stats && (
              <StatsGrid
                stats={stats}
                totalGlobalZpoints={totalGlobalZpoints}
                tapZpUnits={tapZpUnits}
              />
            )}
            {/* Tap-to-earn — always visible on home screen */}
            {user && (
              <TapGame
                fid={user.fid}
                onPointsUpdate={(newTapZpUnits, zpCredited) => {
                  // Show fractional tap ZP immediately in header/stats (sub-1-ZP amounts)
                  // tapZpUnits is the raw ×10000 total; modulo keeps only the carry-over fraction
                  setTapZpUnits(newTapZpUnits % 10_000);
                  // Credit earned whole ZP into the settled main balance
                  if (zpCredited > 0) {
                    setStats(prev => prev ? { ...prev, zpoints: prev.zpoints + zpCredited } : prev);
                  }
                  getGlobalTotalZpoints().then(setTotalGlobalZpoints);
                }}
              />
            )}
            <div className="mx-4">
              <ShareButton
                text={`${stats?.zpoints.toLocaleString() ?? 0} Zpoints earned. ${stats?.currentStreak ?? 0} day streak. Zero Organization. Maximum Points. #ZORG`}
                queryParams={{
                  type: "checkin",
                  zpoints: stats?.zpoints.toString() ?? "0",
                  streak: stats?.currentStreak.toString() ?? "0",
                }}
                variant="outline"
                className="w-full border border-[#00ff41]/20 bg-transparent text-[#00ff41]/60 hover:text-[#00ff41] hover:border-[#00ff41]/40 hover:bg-transparent font-mono text-xs tracking-widest uppercase rounded-none"
              >
                [ share zorg stats ]
              </ShareButton>
            </div>
            <ZorgFooter />
          </div>
        ) : activeView === "leaderboard" ? (
          <Leaderboard currentFid={user?.fid} />
        ) : activeView === "stats" ? (
          <StatsPage stats={stats} />
        ) : activeView === "admin" ? (
          <AdminPanel currentFid={user?.fid ?? 0} />
        ) : activeView === "referral" ? (
          <div className="pb-4 pt-2">
            {user && <ReferralPanel fid={user.fid} username={user.username ?? `fid:${user.fid}`} />}
          </div>
        ) : (
          <AboutPanel />
        )}
      </div>
    </div>
  );
}

function NotConnectedState() {
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);

  async function handleSignIn() {
    setSigning(true);
    setSignError(null);
    try {
      // Prompts the user to connect their Farcaster identity
      // Works in Base app and any client that supports the signIn action
      await sdk.actions.signIn({ nonce: Math.random().toString(36).slice(2) });
      // After sign-in, reload — the SDK context will now be populated
      window.location.reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign in failed";
      setSignError(msg);
      setSigning(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 text-center gap-5">
      <div
        className="text-6xl font-mono font-black text-[#00ff41]"
        style={{ textShadow: "0 0 20px #00ff41, 0 0 40px #00ff41" }}
      >
        ZORG
      </div>

      <div className="space-y-1">
        <p className="font-mono text-sm text-white/70 leading-relaxed">
          Connect your Farcaster account to start earning Zpoints.
        </p>
        <p className="font-mono text-xs text-[#00ff41]/30 tracking-widest uppercase">
          Zero Organization. Maximum Points.
        </p>
      </div>

      <button
        onClick={handleSignIn}
        disabled={signing}
        className="flex items-center gap-3 px-6 py-3 rounded-xl border border-[#00ff41]/40 bg-[#00ff41]/10 hover:bg-[#00ff41]/20 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-wait min-h-[52px]"
      >
        {signing ? (
          <span className="font-mono text-sm text-[#00ff41] tracking-widest animate-pulse">CONNECTING...</span>
        ) : (
          <>
            {/* Farcaster logo */}
            <svg width="18" height="18" viewBox="0 0 1000 1000" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="1000" height="1000" rx="200" fill="#8A63D2"/>
              <path d="M257.778 155.556H742.222V844.444H671.111V528.889H670.414C662.554 441.677 589.258 373.333 500 373.333C410.742 373.333 337.446 441.677 329.586 528.889H328.889V844.444H257.778V155.556Z" fill="white"/>
              <path d="M128.889 253.333L157.778 351.111H182.222V746.667C169.949 746.667 160 756.616 160 768.889V795.556H155.556C143.283 795.556 133.333 805.505 133.333 817.778V844.444H382.222V817.778C382.222 805.505 372.273 795.556 360 795.556H355.556V768.889C355.556 756.616 345.606 746.667 333.333 746.667H306.667V253.333H128.889Z" fill="white"/>
              <path d="M817.778 746.667C805.505 746.667 795.556 756.616 795.556 768.889V795.556H791.111C778.838 795.556 768.889 805.505 768.889 817.778V844.444H1017.78V817.778C1017.78 805.505 1007.83 795.556 995.556 795.556H991.111V768.889C991.111 756.616 981.162 746.667 968.889 746.667V351.111H993.333L1022.22 253.333H844.444V746.667H817.778Z" fill="white"/>
            </svg>
            <span className="font-mono text-sm font-bold text-[#00ff41] tracking-widest">SIGN IN WITH FARCASTER</span>
          </>
        )}
      </button>

      {signError && (
        <p className="font-mono text-[10px] text-red-400/70 max-w-xs leading-relaxed">
          {signError.includes("rejected") || signError.includes("cancel")
            ? "Sign in cancelled."
            : `Error: ${signError}`}
        </p>
      )}

      <p className="font-mono text-[10px] text-white/20 max-w-xs leading-relaxed">
        Opens in Warpcast or your Farcaster client to authenticate
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center h-full">
      <p className="font-mono text-sm text-[#00ff41]/40 animate-pulse tracking-widest">
        LOADING...
      </p>
    </div>
  );
}

function ZorgFooter() {
  return (
    <div className="mx-4 pt-1">
      <p className="font-mono text-[10px] text-[#00ff41]/20 text-center tracking-widest">
        1,000,000,000 ZORG TOKENS INCOMING
      </p>
    </div>
  );
}
