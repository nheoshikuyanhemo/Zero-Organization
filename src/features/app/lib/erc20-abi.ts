// ─── ZORG ERC-20 ABI ──────────────────────────────────────────────────────
// Contract: ZorgToken (Solidity 0.8.20, optimizer 200 runs)
// Includes rescue functions for recovering stuck ETH/tokens sent to contract
// Bytecode lives in erc20-bytecode.ts (written via Node to avoid file truncation)
export { ERC20_BYTECODE } from "./erc20-bytecode";

export const ERC20_ABI = [
  {
    type: "constructor",
    inputs: [
      { name: "_name", type: "string" },
      { name: "_symbol", type: "string" },
      { name: "_totalSupply", type: "uint256" },
      { name: "_owner", type: "address" },
    ],
  },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "function", name: "balanceOf", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "allowance", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "transfer", stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function", name: "approve", stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function", name: "transferFrom", stateMutability: "nonpayable",
    inputs: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  // ── Rescue functions (owner-only) ─────────────────────────────────────────
  {
    type: "function", name: "rescueETH", stateMutability: "nonpayable",
    inputs: [], outputs: [],
  },
  {
    type: "function", name: "rescueTokens", stateMutability: "nonpayable",
    inputs: [{ name: "tokenAddress", type: "address" }], outputs: [],
  },
  // ── Events ────────────────────────────────────────────────────────────────
  {
    type: "event", name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event", name: "Approval",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "spender", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
  { type: "receive", stateMutability: "payable" },
] as const;


// ─── Rescue ABI (standalone, for calling rescue on deployed contract) ────────
export const RESCUE_ABI = [
  {
    type: "function", name: "rescueETH", stateMutability: "nonpayable",
    inputs: [], outputs: [],
  },
  {
    type: "function", name: "rescueTokens", stateMutability: "nonpayable",
    inputs: [{ name: "tokenAddress", type: "address" }], outputs: [],
  },
  {
    type: "function", name: "owner", stateMutability: "view",
    inputs: [], outputs: [{ type: "address" }],
  },
] as const;

// ─── Uniswap V3 on Base ────────────────────────────────────────────────────

/** Uniswap V3 NonfungiblePositionManager on Base mainnet */
export const UNISWAP_V3_POSITION_MANAGER = "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f" as const;

/** Uniswap V3 Factory on Base mainnet */
export const UNISWAP_V3_FACTORY = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD" as const;

/** WETH on Base mainnet */
export const WETH_BASE = "0x4200000000000000000000000000000000000006" as const;

/** Burn address for LP NFT */
export const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD" as const;

/** Fee tier 1% = 10000 (standard for new/volatile tokens) */
export const UNISWAP_FEE_TIER = 10000;

/**
 * sqrtPriceX96 for ZORG/WETH pool initialization.
 * Sets initial price: 1 ETH = 4,000,000 ZORG (conservative for new token).
 *
 * Formula (when ZORG is token0, i.e. ZORG address < WETH address):
 *   price = WETH_per_ZORG = 1/4_000_000
 *   sqrtPriceX96 = sqrt(1/4_000_000) * 2^96
 *                = sqrt(2.5e-7) * 79228162514264337593543950336
 *                ≈ 1253318137983 * 2^48 (scaled down to fit uint160)
 *
 * If WETH is token0 (WETH < ZORG), the deploy-contracts-panel.tsx inverts this.
 */
export const SQRT_PRICE_ZORG_WETH = BigInt("1253318137983");

/** NonfungiblePositionManager ABI — only the functions we need */
export const POSITION_MANAGER_ABI = [
  {
    type: "function",
    name: "createAndInitializePoolIfNecessary",
    stateMutability: "payable",
    inputs: [
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "sqrtPriceX96", type: "uint160" },
    ],
    outputs: [{ name: "pool", type: "address" }],
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "token0", type: "address" },
          { name: "token1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickLower", type: "int24" },
          { name: "tickUpper", type: "int24" },
          { name: "amount0Desired", type: "uint256" },
          { name: "amount1Desired", type: "uint256" },
          { name: "amount0Min", type: "uint256" },
          { name: "amount1Min", type: "uint256" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
        ],
      },
    ],
    outputs: [
      { name: "tokenId", type: "uint256" },
      { name: "liquidity", type: "uint128" },
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "multicall",
    stateMutability: "payable",
    inputs: [{ name: "data", type: "bytes[]" }],
    outputs: [{ name: "results", type: "bytes[]" }],
  },
  {
    type: "function",
    name: "refundETH",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "transferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "tokenId", type: "uint256" }],
    outputs: [],
  },
] as const;
