/**
 * Tap achievement definitions and unlock logic.
 * Pure functions — no DB, no "use server".
 */

export interface TapAchievement {
  id: string;
  emoji: string;
  title: string;
  description: string;
  tier: "bronze" | "silver" | "gold" | "diamond";
  unlocked: boolean;
  progress: number;    // 0–100 percent toward unlock
  progressLabel: string;
}

export interface TapAchievementState {
  tapZpUnits: number;       // lifetime ×10000
  tapZpCredited: number;    // whole ZP credited lifetime
  paidEnergyCharges: number;
  paidEnergyUsed: number;
  freeEnergyUsed: number;   // today's free taps used
}

const UNITS_PER_ZP = 10_000;
const PAID_TAP_UNITS = 1000; // units per paid tap (matches tap-config.ts)

const TIER_COLORS = {
  bronze:  { border: "#cd7f32", text: "#e8956a", bg: "#2a1500" },
  silver:  { border: "#aaaaaa", text: "#d0d0d0", bg: "#1a1a1a" },
  gold:    { border: "#ffd700", text: "#ffe566", bg: "#1f1800" },
  diamond: { border: "#00d4ff", text: "#7ef7ff", bg: "#001a20" },
} as const;

export { TIER_COLORS };

function pct(value: number, target: number) {
  return Math.min(100, Math.round((value / target) * 100));
}

function fmtUnits(units: number): string {
  const zp = units / UNITS_PER_ZP;
  if (zp >= 1) return `${zp.toFixed(1)} ZP`;
  // Show as fraction of 1 ZP so user understands how close they are
  return `${zp.toFixed(4)} ZP`;
}

export function computeTapAchievements(s: TapAchievementState): TapAchievement[] {
  // Derive free tap count: total units minus units from paid taps, then ÷ 1 (1 unit per free tap)
  const paidUnits = s.paidEnergyUsed * PAID_TAP_UNITS;
  const freeUnits = Math.max(0, s.tapZpUnits - paidUnits);
  const totalFreeTapsEver = freeUnits; // 1 unit per free tap
  const totalPaidTapsEver = s.paidEnergyUsed;
  const totalZpEarned = s.tapZpUnits / UNITS_PER_ZP;
  const paidCharges = s.paidEnergyCharges;

  return [
    // ── Tap count milestones ──────────────────────────────────────
    {
      id: "first_tap",
      emoji: "👆",
      title: "First Tap",
      description: "Make your first tap",
      tier: "bronze",
      unlocked: s.tapZpUnits > 0,
      progress: pct(s.tapZpUnits, 1),
      progressLabel: s.tapZpUnits > 0 ? "done" : "0 / 1 tap",
    },
    {
      id: "hundred_taps",
      emoji: "🖱️",
      title: "Clicker",
      description: "Reach 100 free taps",
      tier: "bronze",
      unlocked: totalFreeTapsEver >= 100,
      progress: pct(Math.min(totalFreeTapsEver, 100), 100),
      progressLabel: `${Math.min(totalFreeTapsEver, 100)} / 100`,
    },
    {
      id: "thousand_taps",
      emoji: "⚡",
      title: "Tapper",
      description: "Reach 1,000 free taps",
      tier: "silver",
      unlocked: totalFreeTapsEver >= 1_000,
      progress: pct(Math.min(totalFreeTapsEver, 1_000), 1_000),
      progressLabel: `${Math.min(totalFreeTapsEver, 1_000).toLocaleString()} / 1,000`,
    },
    {
      id: "ten_thousand_taps",
      emoji: "🔥",
      title: "Fanatic",
      description: "Reach 10,000 free taps",
      tier: "gold",
      unlocked: totalFreeTapsEver >= 10_000,
      progress: pct(Math.min(totalFreeTapsEver, 10_000), 10_000),
      progressLabel: `${Math.min(totalFreeTapsEver, 10_000).toLocaleString()} / 10,000`,
    },
    {
      id: "hundred_thousand_taps",
      emoji: "💀",
      title: "Tap Demon",
      description: "Max out free energy (100K taps)",
      tier: "diamond",
      unlocked: totalFreeTapsEver >= 100_000,
      progress: pct(Math.min(totalFreeTapsEver, 100_000), 100_000),
      progressLabel: `${Math.min(totalFreeTapsEver, 100_000).toLocaleString()} / 100,000`,
    },

    // ── ZP earned milestones ──────────────────────────────────────
    {
      id: "one_zp",
      emoji: "🌱",
      title: "First ZP",
      description: "Earn 1 ZP from tapping",
      tier: "bronze",
      unlocked: totalZpEarned >= 1,
      progress: pct(Math.min(s.tapZpUnits, UNITS_PER_ZP), UNITS_PER_ZP),
      progressLabel: `${fmtUnits(Math.min(s.tapZpUnits, UNITS_PER_ZP))} / 1 ZP`,
    },
    {
      id: "ten_zp",
      emoji: "💚",
      title: "Free Maxed",
      description: "Earn 10 ZP from free taps",
      tier: "silver",
      unlocked: totalZpEarned >= 10,
      progress: pct(Math.min(totalZpEarned, 10), 10),
      progressLabel: `${Math.min(totalZpEarned, 10).toFixed(2)} / 10 ZP`,
    },
    {
      id: "hundred_zp",
      emoji: "🟣",
      title: "Energy Hoarder",
      description: "Earn 100 ZP from tapping",
      tier: "gold",
      unlocked: totalZpEarned >= 100,
      progress: pct(Math.min(totalZpEarned, 100), 100),
      progressLabel: `${Math.min(totalZpEarned, 100).toFixed(1)} / 100 ZP`,
    },
    {
      id: "five_hundred_zp",
      emoji: "💎",
      title: "Paid Max",
      description: "Earn 500 ZP in a single paid charge",
      tier: "diamond",
      unlocked: totalZpEarned >= 500,
      progress: pct(Math.min(totalZpEarned, 500), 500),
      progressLabel: `${Math.min(totalZpEarned, 500).toFixed(1)} / 500 ZP`,
    },

    // ── Paid energy milestones ────────────────────────────────────
    {
      id: "first_paid",
      emoji: "💸",
      title: "Energy Buyer",
      description: "Purchase paid energy for the first time",
      tier: "silver",
      unlocked: paidCharges >= 1,
      progress: pct(paidCharges, 1),
      progressLabel: paidCharges >= 1 ? "done" : "0 / 1 charge",
    },
    {
      id: "five_paid",
      emoji: "🔋",
      title: "Power User",
      description: "Purchase paid energy 5 times",
      tier: "gold",
      unlocked: paidCharges >= 5,
      progress: pct(Math.min(paidCharges, 5), 5),
      progressLabel: `${Math.min(paidCharges, 5)} / 5 charges`,
    },
    {
      id: "paid_drained",
      emoji: "🌀",
      title: "Fully Drained",
      description: "Use up an entire paid energy charge",
      tier: "gold",
      unlocked: totalPaidTapsEver >= 5_000,
      progress: pct(Math.min(totalPaidTapsEver, 5_000), 5_000),
      progressLabel: `${Math.min(totalPaidTapsEver, 5_000).toLocaleString()} / 5,000 paid taps`,
    },
  ];
}
