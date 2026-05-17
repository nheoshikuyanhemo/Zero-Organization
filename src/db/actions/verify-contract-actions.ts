"use server";

import { encodeAbiParameters, parseAbiParameters, parseUnits } from "viem";
import { DEV_WALLET_ADDRESS } from "@/features/app/lib/zorg-config";
import { ZORG_TOKEN_SOURCE } from "@/features/app/lib/zorg-token-source";
import { ZORG_BANK_SOURCE } from "@/features/app/lib/zorg-bank-source";

export interface VerifyResult {
  success: boolean;
  guid?: string;
  message: string;
  alreadyVerified?: boolean;
}

export interface VerifyStatusResult {
  success: boolean;
  status: "pass" | "fail" | "pending" | "unknown";
  message: string;
}

/**
 * Submit contract source to Basescan for verification.
 * Uses the Basescan v2 API (same as Etherscan).
 * Returns a GUID you can poll with checkVerifyStatus.
 */
export async function submitContractVerification(
  contractAddress: string
): Promise<VerifyResult> {
  const apiKey = process.env.BASESCAN_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      message: "BASESCAN_API_KEY not set — add it to your environment variables",
    };
  }

  // ABI-encode constructor args: (string name, string symbol, uint256 totalSupply, address owner)
  let constructorArgs: string;
  try {
    const encoded = encodeAbiParameters(
      parseAbiParameters("string, string, uint256, address"),
      [
        "Zero Organization",
        "ZORG",
        parseUnits("1000000000", 18),
        DEV_WALLET_ADDRESS as `0x${string}`,
      ]
    );
    constructorArgs = encoded.slice(2); // strip 0x
  } catch (err) {
    return {
      success: false,
      message: `Failed to encode constructor args: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const params = new URLSearchParams({
    chainid: "8453", // Base mainnet
    module: "contract",
    action: "verifysourcecode",
    apikey: apiKey,
    contractaddress: contractAddress,
    sourceCode: ZORG_TOKEN_SOURCE,
    codeformat: "solidity-single-file",
    contractname: "ZorgToken",
    compilerversion: "v0.8.20+commit.a1b79de6",
    optimizationUsed: "1",
    runs: "200",
    constructorArguements: constructorArgs, // Basescan uses this typo in their API
    evmversion: "london",
    licenseType: "3", // MIT
  });

  try {
    const res = await fetch("https://api.basescan.org/api", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!res.ok) {
      return { success: false, message: `Basescan API error: ${res.status} ${res.statusText}` };
    }

    const data = await res.json() as { status: string; result: string; message?: string };

    // Already verified
    if (data.result?.toLowerCase().includes("already verified")) {
      return { success: true, alreadyVerified: true, message: "Contract is already verified on Basescan!" };
    }

    if (data.status === "1") {
      return { success: true, guid: data.result, message: "Verification submitted! Checking status..." };
    }

    return { success: false, message: data.result ?? data.message ?? "Unknown error from Basescan" };
  } catch (err) {
    return {
      success: false,
      message: `Network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Poll verification status using the GUID returned by submitContractVerification.
 */
export async function checkVerifyStatus(guid: string): Promise<VerifyStatusResult> {
  const apiKey = process.env.BASESCAN_API_KEY;
  if (!apiKey) {
    return { success: false, status: "unknown", message: "BASESCAN_API_KEY not set" };
  }

  const url = new URL("https://api.basescan.org/api");
  url.searchParams.set("chainid", "8453");
  url.searchParams.set("module", "contract");
  url.searchParams.set("action", "checkverifystatus");
  url.searchParams.set("guid", guid);
  url.searchParams.set("apikey", apiKey);

  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      return { success: false, status: "unknown", message: `API error: ${res.status}` };
    }

    const data = await res.json() as { status: string; result: string };

    if (data.result?.toLowerCase().includes("pass") || data.result?.toLowerCase().includes("already verified")) {
      return { success: true, status: "pass", message: "Contract verified successfully!" };
    }

    if (data.result?.toLowerCase().includes("fail")) {
      return { success: false, status: "fail", message: data.result };
    }

    if (data.result?.toLowerCase().includes("pending") || data.result?.toLowerCase().includes("queue")) {
      return { success: true, status: "pending", message: "Verification in progress..." };
    }

    return { success: true, status: "pending", message: data.result ?? "Checking..." };
  } catch (err) {
    return {
      success: false,
      status: "unknown",
      message: `Network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Submit ZorgBank source to Basescan for verification.
 * Constructor: (address _owner, address _operator)
 */
export async function submitBankVerification(
  contractAddress: string,
  operatorAddress: string
): Promise<VerifyResult> {
  const apiKey = process.env.BASESCAN_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      message: "BASESCAN_API_KEY not set — add it to your environment variables",
    };
  }

  let constructorArgs: string;
  try {
    const encoded = encodeAbiParameters(
      parseAbiParameters("address, address"),
      [
        DEV_WALLET_ADDRESS as `0x${string}`,
        (operatorAddress || DEV_WALLET_ADDRESS) as `0x${string}`,
      ]
    );
    constructorArgs = encoded.slice(2);
  } catch (err) {
    return {
      success: false,
      message: `Failed to encode constructor args: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const params = new URLSearchParams({
    chainid: "8453",
    module: "contract",
    action: "verifysourcecode",
    apikey: apiKey,
    contractaddress: contractAddress,
    sourceCode: ZORG_BANK_SOURCE,
    codeformat: "solidity-single-file",
    contractname: "ZorgBank",
    compilerversion: "v0.8.20+commit.a1b79de6",
    optimizationUsed: "1",
    runs: "200",
    constructorArguements: constructorArgs,
    evmversion: "london",
    licenseType: "3", // MIT
  });

  try {
    const res = await fetch("https://api.basescan.org/api", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!res.ok) {
      return { success: false, message: `Basescan API error: ${res.status} ${res.statusText}` };
    }

    const data = await res.json() as { status: string; result: string; message?: string };

    if (data.result?.toLowerCase().includes("already verified")) {
      return { success: true, alreadyVerified: true, message: "ZorgBank is already verified!" };
    }

    if (data.status === "1") {
      return { success: true, guid: data.result, message: "Submitted! Checking status..." };
    }

    return { success: false, message: data.result ?? data.message ?? "Unknown error from Basescan" };
  } catch (err) {
    return {
      success: false,
      message: `Network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
