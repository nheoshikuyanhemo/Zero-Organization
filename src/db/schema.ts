import { pgTable, text, integer, timestamp, uuid, bigint, boolean } from "drizzle-orm/pg-core";

/**
 * Key-Value Store Table
 *
 * Built-in table for simple key-value storage.
 * Available immediately without schema changes.
 *
 * ⚠️ CRITICAL: DO NOT DELETE OR EDIT THIS TABLE DEFINITION ⚠️
 * This table is required for the app to function properly.
 * DO NOT delete, modify, rename, or change any part of this table.
 * Removing or editing it will cause database schema conflicts and prevent
 * the app from starting.
 *
 * Use for:
 * - User preferences/settings
 * - App configuration
 * - Simple counters
 * - Temporary data
 */
export const kv = pgTable("kv", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/**
 * User stats — one row per Farcaster user
 * Stores cumulative Zpoints, streak, and check-in history
 */
export const userStats = pgTable("user_stats", {
  fid: integer("fid").primaryKey(),
  username: text("username").notNull(),
  displayName: text("display_name").notNull(),
  pfpUrl: text("pfp_url"),
  zpoints: integer("zpoints").notNull().default(0),
  currentStreak: integer("current_streak").notNull().default(0),
  longestStreak: integer("longest_streak").notNull().default(0),
  totalCheckIns: integer("total_check_ins").notNull().default(0),
  lastCheckIn: text("last_check_in"), // ISO date string YYYY-MM-DD
  streakMultiplier: integer("streak_multiplier").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Individual check-in log — one row per check-in event
 */
export const checkIns = pgTable("check_ins", {
  id: uuid("id").primaryKey().defaultRandom(),
  fid: integer("fid").notNull(),
  date: text("date").notNull(), // YYYY-MM-DD
  pointsEarned: integer("points_earned").notNull(),
  streakDay: integer("streak_day").notNull(),
  multiplier: integer("multiplier").notNull().default(1),
  sessionId: integer("session_id").notNull().default(1),
  // ETH fee paid on-chain (nullable — old rows before fee was added are null)
  ethFeePaid: text("eth_fee_paid"), // stored as string e.g. "0.0001"
  txHash: text("tx_hash"),         // on-chain tx hash of the fee payment
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * ZORG sessions — tracks the 100-day distribution cycle
 */
export const sessions = pgTable("sessions", {
  id: integer("id").primaryKey(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endsAt: timestamp("ends_at").notNull(),
  totalZpoints: integer("total_zpoints").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  isDistributed: boolean("is_distributed").notNull().default(false),
  distributedAt: timestamp("distributed_at"),
});

/**
 * Token distribution records — tracks ZORG token payouts after session ends
 * Uses a state machine: unclaimed → pending → paid | failed
 */
export const tokenDistributions = pgTable("token_distributions", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: integer("session_id").notNull(),
  fid: integer("fid").notNull(),
  recipientAddress: text("recipient_address").notNull(),
  zpoints: integer("zpoints").notNull(),
  tokenAmount: text("token_amount").notNull(), // stored as string for BigInt precision
  status: text("status").notNull().default("unclaimed"), // unclaimed | pending | paid | failed
  txHash: text("tx_hash"),
  failureReason: text("failure_reason"),
  retryCount: integer("retry_count").notNull().default(0),
  claimStartedAt: timestamp("claim_started_at"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // Vesting: which tranche this row belongs to (1–6 for users, 1–360 for dev)
  // null = legacy row (pre-vesting, treat as tranche 1)
  vestedTranche: integer("vested_tranche"),
  // totalAllocation = full lifetime token entitlement for this fid (used to compute per-tranche amounts)
  totalAllocation: text("total_allocation"),
});

/**
 * Tap game — energy + accumulated tap points per user
 * free_taps_today: taps used from free energy today (resets daily)
 * paid_charges: number of paid energy top-ups used (each gives 500 extra tap pts cap)
 * tap_points: total tap ZP earned lifetime
 */
export const tapGame = pgTable("tap_game", {
  fid: integer("fid").primaryKey(),
  // Accumulated ZP stored as integer ×10000 (avoids floats):
  //   1 free tap  = 1 unit  (0.0001 ZP)
  //   1 paid tap  = 1000 units (0.1 ZP)
  tapZpUnits: bigint("tap_zp_units", { mode: "number" }).notNull().default(0),
  // Integer ZP already credited to userStats.zpoints (used to compute delta each batch)
  tapZpCredited: integer("tap_zp_credited").notNull().default(0),
  // Free energy (daily reset)
  freeEnergyUsed: integer("free_energy_used").notNull().default(0), // free taps used today
  lastFreeReset: text("last_free_reset"),                            // YYYY-MM-DD of last reset
  // Paid energy
  paidEnergyCharges: integer("paid_energy_charges").notNull().default(0),
  paidEnergyUsed: integer("paid_energy_used").notNull().default(0),
  lastPaidTxHash: text("last_paid_tx_hash"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Referrals — tracks who referred whom and the bonus ZP earned by the referrer
 * referrer_fid: the user who invited
 * referee_fid: the user who joined via referral
 * join_bonus_paid: whether the 10 ZP join bonus has been awarded
 * total_bonus_earned: cumulative 25% bonus ZP earned from referee's onchain activity
 */
export const referrals = pgTable("referrals", {
  id: uuid("id").primaryKey().defaultRandom(),
  referrerFid: integer("referrer_fid").notNull(),
  refereeFid: integer("referee_fid").notNull().unique(), // one referee can only have one referrer
  joinBonusPaid: boolean("join_bonus_paid").notNull().default(false),
  totalBonusEarned: integer("total_bonus_earned").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Daily tap history — one row per user per day, tracks tap ZP units earned
 * tapZpUnits: total ×10000 units earned that day (sum of all batch flushes)
 */
export const tapHistory = pgTable("tap_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  fid: integer("fid").notNull(),
  date: text("date").notNull(),   // YYYY-MM-DD
  tapZpUnits: bigint("tap_zp_units", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Fee log — tracks every 0.1% fee routed to the app wallet
 */
export const feeLogs = pgTable("fee_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  fid: integer("fid").notNull(),
  sessionId: integer("session_id").notNull(),
  zpoints: integer("zpoints").notNull(),
  feeZpoints: integer("fee_zpoints").notNull(), // 0.1% of zpoints
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
