"use client";

import { AppView } from "../types";

interface NavTabsProps {
  activeView: AppView;
  onViewChange: (view: AppView) => void;
  isAdmin?: boolean;
}

const BASE_TABS: { id: AppView; label: string }[] = [
  { id: "home", label: "CHECK IN" },
  { id: "leaderboard", label: "RANKS" },
  { id: "stats", label: "STATS" },
  { id: "referral", label: "INVITE" },
  { id: "about", label: "ABOUT" },
];

export function NavTabs({ activeView, onViewChange, isAdmin }: NavTabsProps) {
  const tabs = isAdmin
    ? [...BASE_TABS, { id: "admin" as AppView, label: "ADMIN" }]
    : BASE_TABS;

  return (
    <div className="flex mx-4 gap-1 bg-[#0a0a0a] rounded-lg p-1 border border-[#00ff41]/10">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onViewChange(tab.id)}
          className={`
            flex-1 py-2 rounded-md font-mono text-xs font-bold tracking-widest uppercase
            transition-all duration-150 select-none
            ${
              activeView === tab.id
                ? tab.id === "admin"
                  ? "bg-red-500/80 text-white"
                  : "bg-[#00ff41] text-black"
                : tab.id === "admin"
                ? "text-red-400/50 hover:text-red-400/80"
                : "text-[#00ff41]/50 hover:text-[#00ff41]/80"
            }
          `}
          style={
            activeView === tab.id && tab.id !== "admin"
              ? { boxShadow: "0 0 10px rgba(0,255,65,0.4)" }
              : {}
          }
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
