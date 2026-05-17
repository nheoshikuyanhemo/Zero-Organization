// ZORG protocol constants — safe to import anywhere (not a server action file)

// ─── Wallets ───────────────────────────────────────────────────────────────
// Dev wallet: receives 5% of total supply + 0.1% protocol fee on check-ins
export const DEV_WALLET_ADDRESS = "0xfc5523b564fb51532A6d7058E48324c28D30D312";
export const FEE_CHAIN = "base";

// ─── Session config ────────────────────────────────────────────────────────
export const SESSION_DURATION_DAYS = 100;
// Distribution triggers on Day 101 (one day after session ends)
export const DISTRIBUTION_TRIGGER_DAY = 101;
export const CURRENT_SESSION_ID = 1;

// ─── Points config ─────────────────────────────────────────────────────────
export const BASE_POINTS_PER_DAY = 100; // Day 1 minimum base points
// 0.1% protocol fee on every check-in, goes to dev wallet / liquidity
export const FEE_BPS = 10;    // 10 / 10000 = 0.1%
export const TOTAL_BPS = 10000;

// ─── Token supply: 1,000,000,000 ZORG ─────────────────────────────────────
export const TOTAL_TOKEN_SUPPLY = BigInt(1_000_000_000);

// Allocation splits (basis points, must sum to 10000)
// 70% check-in users · 25% liquidity · 5% dev
export const USER_ALLOC_BPS   = 7000; // 70%
export const LIQUIDITY_ALLOC_BPS = 2500; // 25%
export const DEV_ALLOC_BPS    = 500;  // 5%
const _CHECK_SUM = USER_ALLOC_BPS + LIQUIDITY_ALLOC_BPS + DEV_ALLOC_BPS;
// Static assertion — compile-time guard
export const _ALLOC_SUM_CHECK: 10000 = _CHECK_SUM as 10000;

// Computed absolute amounts (BigInt)
export const USER_TOKEN_POOL    = (TOTAL_TOKEN_SUPPLY * BigInt(USER_ALLOC_BPS)) / BigInt(10000);    // 700,000,000
export const LIQUIDITY_TOKEN_POOL = (TOTAL_TOKEN_SUPPLY * BigInt(LIQUIDITY_ALLOC_BPS)) / BigInt(10000); // 250,000,000
export const DEV_TOKEN_AMOUNT   = (TOTAL_TOKEN_SUPPLY * BigInt(DEV_ALLOC_BPS)) / BigInt(10000);     // 50,000,000

// ─── Vesting schedule ──────────────────────────────────────────────────────
// Users: 70% pool split into 6 equal monthly tranches.
//   Each distribution run sends 1/6 of the user's total allocation.
//   Admin triggers each monthly run from the admin panel.
export const USER_VESTING_TRANCHES = 6;         // 6 monthly distributions
export const USER_TRANCHE_BPS = Math.floor(10000 / USER_VESTING_TRANCHES); // ~1666 bps each (~16.67%)

// Dev: 5% pool vests linearly over 360 days.
//   Each day: DEV_TOKEN_AMOUNT / 360 tokens become claimable.
//   Admin runs distribution to claim all accrued-but-unclaimed days.
export const DEV_VESTING_DAYS = 360;
// KV keys for vesting state
export const KV_VESTING_STARTED_AT = "zorg:vesting_started_at";  // ISO timestamp of first distribution run
export const KV_USER_TRANCHE_SENT  = "zorg:user_tranche_sent";   // last completed tranche number (1–6)
export const KV_DEV_DAYS_CLAIMED   = "zorg:dev_days_claimed";    // how many vesting days have been sent

// ─── Fee usage ─────────────────────────────────────────────────────────────
// 0.1% of Zpoints earned each check-in → logged → funds liquidity in full
// (the protocol fee IS the liquidity source — all fee Zpoints go to liquidity)
export const FEE_WALLET_ADDRESS = DEV_WALLET_ADDRESS; // alias for backwards compat

// ─── Escalating ETH check-in fee ───────────────────────────────────────────
// Day 1:   0.00005 ETH (minimum)
// Day 100: 0.00010 ETH (maximum, exactly 2× day 1)
// Formula: fee = 0.00005 × 2^((day-1)/99)
// Growth:  ~0.70% per day (well above the 0.1% minimum requirement)
export const CHECKIN_FEE_MIN_ETH = 0.00005;
export const CHECKIN_FEE_MAX_ETH = 0.00010;

/**
 * Compute the ETH check-in fee for a given session day (1–100).
 * Returns a fixed-precision string like "0.00005" for use with parseEther.
 */
export function getCheckinFeeEth(sessionDay: number): string {
  const day = Math.max(1, Math.min(100, sessionDay));
  // Exponential interpolation: doubles from day 1 to day 100
  const fee = CHECKIN_FEE_MIN_ETH * Math.pow(2, (day - 1) / 99);
  // Round to 8 decimal places to avoid floating-point noise
  return fee.toFixed(8);
}

/**
 * Human-readable fee display string, e.g. "0.0000523 ETH"
 */
export function formatCheckinFee(sessionDay: number): string {
  const fee = parseFloat(getCheckinFeeEth(sessionDay));
  // Show up to 7 significant digits, strip trailing zeros
  return fee.toFixed(7).replace(/\.?0+$/, "") + " ETH";
}

// ─── Escalating base points ────────────────────────────────────────────────
// Day 1:   100 points (minimum)
// Day 100: 200 points (maximum, exactly 2× day 1)
// Formula: points = 100 × 2^((day-1)/99)  — mirrors the fee curve
// Same ~0.70%/day growth so points and fee scale together
export const BASE_POINTS_MIN = 100;
export const BASE_POINTS_MAX = 200;

/**
 * Compute the base points for a given session day (1–100).
 * Returns an integer — floored so points are always whole numbers.
 */
export function getBasePointsForDay(sessionDay: number): number {
  const day = Math.max(1, Math.min(100, sessionDay));
  const points = BASE_POINTS_MIN * Math.pow(2, (day - 1) / 99);
  return Math.floor(points);
}

// ─── Streak multiplier (rolling 3-day cycle) ──────────────────────────────
// streak 1-2  → 1x
// streak 3-5  → 2x
// streak 6-8  → 3x
// streak 9-11 → 4x
// streak 12+  → 5x (cap)
// Formula: Math.min(5, 1 + Math.floor(streak / 3))
export function getStreakMultiplier(streak: number): number {
  return Math.min(5, 1 + Math.floor(streak / 3));
}
