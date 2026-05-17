export interface UserStats {
  fid: number;
  username: string;
  displayName: string;
  pfpUrl?: string | null;
  zpoints: number;
  currentStreak: number;
  longestStreak: number;
  totalCheckIns: number;
  lastCheckIn: string | null;
  streakMultiplier: number;
}

export interface CheckInResult {
  success: boolean;
  pointsEarned: number;
  newTotal: number;
  newStreak: number;
  multiplier: number;
  alreadyCheckedIn: boolean;
  message: string;
  feeZpoints?: number;
}

export interface SessionInfo {
  daysElapsed: number;
  daysRemaining: number;
  progressPct: number;
  isEnded: boolean;
  totalZpoints: number;
  endsAt: string;
}

export type AppView = "home" | "leaderboard" | "stats" | "about" | "admin" | "referral";
