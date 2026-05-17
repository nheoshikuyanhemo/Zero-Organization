// Tap game constants — shared between client and server
//
// Two energy tiers with different ZP rates:
//   FREE  — 0.0001 ZP per tap, max 10 ZP → 100,000 free taps per energy charge
//   PAID  — 0.1   ZP per tap, max 500 ZP → 5,000 paid taps per energy charge
//
// Internally all ZP is stored scaled ×10000 (so 1 free tap = 1 unit, 1 paid tap = 1000 units)
// userStats.zpoints receives whole integer ZP as threshold is crossed each batch

// Free energy
export const FREE_TAPS_PER_CHARGE = 100_000;  // taps per daily free charge
export const FREE_ZP_PER_TAP = 0.0001;         // ZP earned per free tap (display)
export const FREE_ZP_MAX = 10;                  // max ZP from free energy per day

// Paid energy
export const PAID_TAPS_PER_CHARGE = 5_000;     // taps per paid charge
export const PAID_ZP_PER_TAP = 0.1;            // ZP earned per paid tap (display)
export const PAID_ZP_MAX_PER_CHARGE = 500;     // max ZP per paid charge

// Payment
export const ENERGY_TOP_UP_ETH = "0.0005";     // ETH cost for one paid energy charge

// Internal scaling: store tap ZP as integer ×10000 to avoid floats
// 1 free tap  = 1 unit  = 0.0001 ZP
// 1 paid tap  = 1000 units = 0.1 ZP
export const FREE_TAP_UNITS = 1;       // units per free tap
export const PAID_TAP_UNITS = 1000;    // units per paid tap
export const UNITS_PER_ZP   = 10_000; // units needed for 1 whole ZP
