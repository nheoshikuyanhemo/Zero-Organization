// ─── ZorgBank ABI ─────────────────────────────────────────────────────────
// Contract: ZorgBank (Solidity 0.8.20, optimizer 200 runs, EVM london)
// Vault that holds ZORG tokens + ETH. Owner = dev wallet. Operator = Neynar server wallet.
export { BANK_BYTECODE } from "./bank-bytecode";

export const BANK_ABI = [
  {
    type: "constructor",
    inputs: [
      { name: "_owner", type: "address" },
      { name: "_operator", type: "address" },
    ],
  },
  // ── Views ────────────────────────────────────────────────────────────────
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "operator", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "ethBalance", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function", name: "tokenBalance", stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  // ── Token ops ────────────────────────────────────────────────────────────
  {
    type: "function", name: "sendTokens", stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function", name: "approveToken", stateMutability: "nonpayable",
    inputs: [{ name: "token", type: "address" }, { name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [],
  },
  // ── ETH ops ──────────────────────────────────────────────────────────────
  {
    type: "function", name: "withdrawETH", stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function", name: "withdrawAllETH", stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }],
    outputs: [],
  },
  // ── Admin ────────────────────────────────────────────────────────────────
  {
    type: "function", name: "setOperator", stateMutability: "nonpayable",
    inputs: [{ name: "newOperator", type: "address" }],
    outputs: [],
  },
  {
    type: "function", name: "transferOwnership", stateMutability: "nonpayable",
    inputs: [{ name: "newOwner", type: "address" }],
    outputs: [],
  },
  // ── Events ───────────────────────────────────────────────────────────────
  {
    type: "event", name: "TokensSent",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event", name: "ETHWithdrawn",
    inputs: [
      { name: "to", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event", name: "ETHReceived",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  { type: "receive", stateMutability: "payable" },
] as const;
