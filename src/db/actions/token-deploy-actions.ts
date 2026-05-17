"use server";

import { kvGet, kvSet } from "@/neynar-db-sdk";
import { privateConfig } from "@/config/private-config";
import { ERC20_BYTECODE } from "@/features/app/lib/erc20-abi";
import { DEV_WALLET_ADDRESS } from "@/features/app/lib/zorg-config";
import { encodeAbiParameters, parseAbiParameters, parseUnits } from "viem";

const CREATOR_FID = Number(process.env.NEXT_PUBLIC_USER_FID ?? 0);

/**
 * Deploy the ZORG ERC-20 token via the Neynar server wallet on Base.
 * Constructor: (name, symbol, totalSupply, owner) — mints full 1B supply to dev wallet.
 * Saves deployed contract address to KV store after confirmation.
 */
export async function deployZorgToken(callerFid: number): Promise<{
  success: boolean;
  contractAddress?: string;
  txHash?: string;
  error?: string;
}> {
  if (callerFid !== CREATOR_FID) return { success: false, error: "Unauthorized" };

  // Check if already deployed
  const existing = await kvGet("zorg:token_address");
  if (existing) return { success: false, error: `Already deployed: ${existing}` };

  const totalSupply = parseUnits("1000000000", 18).toString();

  try {
    // ABI-encode constructor args: (string name, string symbol, uint256 totalSupply, address owner)
    // viem's encodeAbiParameters handles all dynamic-type offsets correctly
    const abiEncoded = encodeAbiParameters(
      parseAbiParameters("string, string, uint256, address"),
      ["Zero Organization", "ZORG", BigInt(totalSupply), DEV_WALLET_ADDRESS as `0x${string}`]
    );
    // Strip leading 0x from encoded args — bytecode already has its own 0x prefix
    const deployData = ERC20_BYTECODE + abiEncoded.slice(2);

    const res = await fetch("https://api.neynar.com/v2/farcaster/transaction/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": privateConfig.neynarApiKey,
        "x-wallet-id": process.env.NEYNAR_WALLET_ID!,
      },
      body: JSON.stringify({
        network: "base",
        transaction: {
          to: null,          // null = contract deploy
          data: deployData,
          value: "0x0",
        },
      }),
    });

    const result = await res.json();
    if (!res.ok) {
      return { success: false, error: result.message ?? `HTTP ${res.status}` };
    }

    const txHash: string = result.transaction_hash ?? result.txHash;

    // Poll for receipt to get contract address (up to 60s)
    const contractAddress = await waitForContractAddress(txHash);
    if (!contractAddress) {
      return {
        success: false,
        error: `Tx submitted (${txHash}) but contract address not confirmed yet. Check Base explorer and save manually.`,
        txHash,
      };
    }

    // Persist address in KV
    await kvSet("zorg:token_address", contractAddress);

    return { success: true, contractAddress, txHash };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message.slice(0, 200) : "Unknown error",
    };
  }
}

/**
 * Poll Base RPC for tx receipt to extract contract address.
 * Tries every 3s for up to 60s.
 */
async function waitForContractAddress(txHash: string): Promise<string | null> {
  const rpc = "https://mainnet.base.org";
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_getTransactionReceipt",
          params: [txHash],
        }),
      });
      const json = await res.json();
      const addr = json?.result?.contractAddress;
      if (addr) return addr as string;
    } catch {
      // keep polling
    }
  }
  return null;
}

