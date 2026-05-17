"use client";

import { UserStats } from "../types";

const STORAGE_KEY_PREFIX = "zorg_user_";

function getKey(fid: number): string {
  return `${STORAGE_KEY_PREFIX}${fid}`;
}

export function loadUserStats(fid: number, username: string, displayName: string, pfpUrl?: string): UserStats {
  if (typeof window === "undefined") {
    return defaultStats(fid, username, displayName, pfpUrl);
  }
  try {
    const raw = localStorage.getItem(getKey(fid));
    if (!raw) return defaultStats(fid, username, displayName, pfpUrl);
    const parsed = JSON.parse(raw) as UserStats;
    // Always refresh display info
    return { ...parsed, username, displayName, pfpUrl };
  } catch {
    return defaultStats(fid, username, displayName, pfpUrl);
  }
}

export function saveUserStats(stats: UserStats): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(getKey(stats.fid), JSON.stringify(stats));
  } catch {
    // ignore storage errors
  }
}

function defaultStats(fid: number, username: string, displayName: string, pfpUrl?: string): UserStats {
  return {
    fid,
    username,
    displayName,
    pfpUrl,
    zpoints: 0,
    currentStreak: 0,
    longestStreak: 0,
    totalCheckIns: 0,
    lastCheckIn: null,
    streakMultiplier: 1,
  };
}

export function getTodayDateString(): string {
  return new Date().toISOString().split("T")[0];
}

export function getYesterdayDateString(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}
