import { UserStats, CheckInResult } from "../types";
import { getTodayDateString, getYesterdayDateString, saveUserStats } from "./storage";

const BASE_POINTS = 100;

export function getMultiplier(streak: number): number {
  if (streak >= 30) return 5;
  if (streak >= 14) return 4;
  if (streak >= 7) return 3;
  if (streak >= 3) return 2;
  return 1;
}

export function getMultiplierLabel(streak: number): string {
  const m = getMultiplier(streak);
  if (m === 1) return "1x";
  return `${m}x`;
}

export function hasCheckedInToday(stats: UserStats): boolean {
  return stats.lastCheckIn === getTodayDateString();
}

export function performCheckIn(stats: UserStats): { updatedStats: UserStats; result: CheckInResult } {
  const today = getTodayDateString();
  const yesterday = getYesterdayDateString();

  if (stats.lastCheckIn === today) {
    return {
      updatedStats: stats,
      result: {
        success: false,
        pointsEarned: 0,
        newTotal: stats.zpoints,
        newStreak: stats.currentStreak,
        multiplier: stats.streakMultiplier,
        alreadyCheckedIn: true,
        message: "Already checked in today. Come back tomorrow!",
      },
    };
  }

  // Determine new streak
  let newStreak: number;
  if (stats.lastCheckIn === yesterday) {
    newStreak = stats.currentStreak + 1;
  } else {
    // Streak broken or first check-in
    newStreak = 1;
  }

  const multiplier = getMultiplier(newStreak);
  const pointsEarned = BASE_POINTS * multiplier;
  const newTotal = stats.zpoints + pointsEarned;
  const longestStreak = Math.max(stats.longestStreak, newStreak);

  const updatedStats: UserStats = {
    ...stats,
    zpoints: newTotal,
    currentStreak: newStreak,
    longestStreak,
    totalCheckIns: stats.totalCheckIns + 1,
    lastCheckIn: today,
    streakMultiplier: multiplier,
  };

  saveUserStats(updatedStats);

  return {
    updatedStats,
    result: {
      success: true,
      pointsEarned,
      newTotal,
      newStreak,
      multiplier,
      alreadyCheckedIn: false,
      message: getCheckInMessage(newStreak, multiplier),
    },
  };
}

function getCheckInMessage(streak: number, multiplier: number): string {
  if (streak === 1) return "Welcome to ZORG. Your journey begins.";
  if (streak === 3) return "3-day streak. The system notices you.";
  if (streak === 7) return "7 days. You are becoming part of the machine.";
  if (streak === 14) return "14 days. Loyalty recorded on-chain.";
  if (streak === 30) return "30 days. ZORG has accepted you.";
  if (multiplier >= 5) return `${streak} days. Maximum power. ${multiplier}x points.`;
  if (multiplier >= 3) return `${streak}-day streak. ${multiplier}x multiplier active.`;
  return `${streak}-day streak. Keep going.`;
}

export function getNextMilestone(streak: number): { days: number; multiplier: number } | null {
  const milestones = [3, 7, 14, 30];
  for (const m of milestones) {
    if (streak < m) return { days: m, multiplier: getMultiplier(m) };
  }
  return null;
}
