"use client";

import { useState, useEffect } from "react";
import {
  useDeployContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useAccount,
  useSwitchChain,
  useReadContract,
} from "wagmi";
import { parseUnits, formatEther, encodeAbiParameters, parseAbiParameters } from "viem";
import { base } from "viem/chains";
import { kvGet, kvSet } from "@/neynar-db-sdk";
import { BANK_ABI, BANK_BYTECODE } from "@/features/app/lib/bank-abi";
import { ERC20_ABI } from "@/features/app/lib/erc20-abi";
import {
  DEV_WALLET_ADDRESS,
  TOTAL_TOKEN_SUPPLY,
} from "@/features/app/lib/zorg-config";
import { ZORG_BANK_SOURCE } from "@/features/app/lib/zorg-bank-source";
import {
  submitBankVerification,
  checkVerifyStatus,
} from "@/db/actions/verify-contract-actions";

const NEYNAR_WALLET_ADDRESS = process.env.NEXT_PUBLIC_NEYNAR_WALLET_ADDRESS ?? "";
const TOTAL_SUPPLY_WEI = TOTAL_TOKEN_SUPPLY * (BigInt(10) ** BigInt(18));

type Step = "idle" | "pending" | "confirming" | "done" | "error";
interface StepState { status: Step; txHash?: string; error?: string; result?: string; }

interface BankDeployPanelProps {
  currentFid: number;
  onRefresh: () => void;
}

export function BankDeployPanel({ currentFid: _currentFid, onRefresh }: BankDeployPanelProps) {
  const { address: walletAddress } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  const [bankAddress, setBankAddress] = useState<string | null>(null);
  const [tokenAddress, setTokenAddress] = useState<string | null>(null);
  const [manualBankAddr, setManualBankAddr] = useState("");
  const [stepDeploy, setStepDeploy] = useState<StepState>({ status: "idle" });
  const [stepDeposit, setStepDeposit] = useState<StepState>({ status: "idle" });

  // ── Wagmi hooks ─────────────────────────────────────────────────────────
  const { deployContract, data: deployHash, isPending: deployPending, error: deployError } = useDeployContract();
  const { isLoading: deployConfirming, isSuccess: deploySuccess, data: deployReceipt } =
    useWaitForTransactionReceipt({ hash: deployHash });

  const { writeContract: writeTransfer, data: transferHash, isPending: transferPending } = useWriteContract();
  const { isLoading: transferConfirming, isSuccess: transferSuccess, data: transferReceipt } =
    useWaitForTransactionReceipt({ hash: transferHash });

  // Read live balances from chain
  const { data: bankTokenBalance, refetch: refetchBalance } = useReadContract({
    address: bankAddress as `0x${string}` | undefined,
    abi: BANK_ABI,
    functionName: "tokenBalance",
    args: tokenAddress ? [tokenAddress as `0x${string}`] : undefined,
    query: { enabled: !!bankAddress && !!tokenAddress },
  });

  const { data: bankEthBalance, refetch: refetchEth } = useReadContract({
    address: bankAddress as `0x${string}` | undefined,
    abi: BANK_ABI,
    functionName: "ethBalance",
    query: { enabled: !!bankAddress },
  });

  // ── Load state ─────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const [ba, ta] = await Promise.all([
        kvGet("zorg:bank_address"),
        kvGet("zorg:token_address"),
      ]);
      setBankAddress(ba);
      setTokenAddress(ta);
      if (ba) setStepDeploy({ status: "done", result: ba });
      if (ba && await kvGet("zorg:bank_funded")) setStepDeposit({ status: "done", result: "1B ZORG held by bank" });
    }
    load();
  }, []);

  // ── Deploy effects ──────────────────────────────────────────────────────
  useEffect(() => {
    if (deployPending) setStepDeploy({ status: "pending" });
    if (deployHash && deployConfirming) setStepDeploy({ status: "confirming", txHash: deployHash });
  }, [deployPending, deployHash, deployConfirming]);

  useEffect(() => {
    if (!deploySuccess || !deployReceipt?.contractAddress) return;
    const addr = deployReceipt.contractAddress;
    kvSet("zorg:bank_address", addr).then(() => {
      setBankAddress(addr);
      setStepDeploy({ status: "done", result: addr, txHash: deployReceipt.transactionHash });
      onRefresh();
    });
  }, [deploySuccess, deployReceipt]);

  useEffect(() => {
    if (!deployError) return;
    const msg = deployError.message ?? "";
    if (!msg.toLowerCase().includes("rejected")) {
      setStepDeploy({ status: "error", error: msg.slice(0, 120) });
    } else {
      setStepDeploy({ status: "idle" });
    }
  }, [deployError]);

  // ── Transfer effects ────────────────────────────────────────────────────
  useEffect(() => {
    if (transferPending) setStepDeposit({ status: "pending" });
    if (transferHash && transferConfirming) setStepDeposit({ status: "confirming", txHash: transferHash });
  }, [transferPending, transferHash, transferConfirming]);

  useEffect(() => {
    if (!transferSuccess || !transferReceipt) return;
    kvSet("zorg:bank_funded", "true").then(() => {
      setStepDeposit({ status: "done", result: "1,000,000,000 ZORG deposited to bank", txHash: transferReceipt.transactionHash });
      refetchBalance();
      refetchEth();
      onRefresh();
    });
  }, [transferSuccess, transferReceipt]);

  // ── Handlers ────────────────────────────────────────────────────────────
  async function handleDeployBank() {
    if (!walletAddress) { setStepDeploy({ status: "error", error: "Connect wallet first" }); return; }
    try {
      await switchChainAsync({ chainId: base.id });
      setStepDeploy({ status: "pending" });
      deployContract({
        abi: BANK_ABI,
        bytecode: BANK_BYTECODE,
        args: [
          DEV_WALLET_ADDRESS as `0x${string}`,   // owner = dev wallet
          (NEYNAR_WALLET_ADDRESS || DEV_WALLET_ADDRESS) as `0x${string}`, // operator = Neynar server wallet
        ],
        chainId: base.id,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error";
      if (!msg.toLowerCase().includes("rejected")) setStepDeploy({ status: "error", error: msg.slice(0, 100) });
      else setStepDeploy({ status: "idle" });
    }
  }

  async function handleDepositTokens() {
    if (!walletAddress || !bankAddress || !tokenAddress) return;
    try {
      await switchChainAsync({ chainId: base.id });
      setStepDeposit({ status: "pending" });
      writeTransfer({
        address: tokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [bankAddress as `0x${string}`, TOTAL_SUPPLY_WEI],
        chainId: base.id,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error";
      if (!msg.toLowerCase().includes("rejected")) setStepDeposit({ status: "error", error: msg.slice(0, 100) });
      else setStepDeposit({ status: "idle" });
    }
  }

  async function handleSaveBank() {
    const addr = manualBankAddr.trim();
    if (!addr.startsWith("0x") || addr.length !== 42) {
      setStepDeploy({ status: "error", error: "Invalid address" });
      return;
    }
    await kvSet("zorg:bank_address", addr);
    setBankAddress(addr);
    setStepDeploy({ status: "done", result: addr });
    onRefresh();
  }

  const canDeposit = stepDeploy.status === "done" && !!tokenAddress;

  const tokenFmt = bankTokenBalance
    ? (Number(bankTokenBalance) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 0 })
    : "—";
  const ethFmt = bankEthBalance
    ? Number(formatEther(bankEthBalance as bigint)).toFixed(4)
    : "—";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="font-mono text-[9px] font-black px-1.5 py-0.5 rounded bg-purple-400/10 text-purple-400">BANK</span>
        <p className="font-mono text-xs font-bold text-white">ZorgBank Contract</p>
      </div>
      <p className="font-mono text-[9px] text-white/30 leading-relaxed -mt-1">
        The bank vault holds all ZORG tokens and ETH. Check-in fees flow here automatically. Distributions are sent from the bank.
      </p>

      {/* Live bank balances */}
      {bankAddress && (
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-black/40 rounded-lg p-3 border border-purple-400/10">
            <p className="font-mono text-[8px] text-white/30 uppercase tracking-widest mb-1">ZORG Balance</p>
            <p className="font-mono text-sm font-black text-purple-300">{tokenFmt}</p>
          </div>
          <div className="bg-black/40 rounded-lg p-3 border border-purple-400/10">
            <p className="font-mono text-[8px] text-white/30 uppercase tracking-widest mb-1">ETH Balance</p>
            <p className="font-mono text-sm font-black text-purple-300">{ethFmt} ETH</p>
          </div>
        </div>
      )}

      {/* Step A: Deploy Bank */}
      <BankStepCard step="A" title="Deploy ZorgBank" state={stepDeploy}>
        <div className="bg-black/30 rounded p-3 space-y-1">
          {[
            { label: "Owner", value: `${DEV_WALLET_ADDRESS.slice(0, 10)}...` },
            { label: "Operator", value: NEYNAR_WALLET_ADDRESS ? `${NEYNAR_WALLET_ADDRESS.slice(0, 10)}...` : "= owner (set NEYNAR_WALLET_ADDRESS)" },
            { label: "Network", value: "Base mainnet" },
          ].map(({ label, value }) => (
            <div key={label} className="flex justify-between">
              <span className="font-mono text-[9px] text-white/30 uppercase tracking-widest">{label}</span>
              <span className="font-mono text-[9px] text-white/60">{value}</span>
            </div>
          ))}
        </div>

        {stepDeploy.status === "done" && stepDeploy.result && (
          <div className="bg-black/40 rounded px-3 py-2 border border-purple-400/20">
            <p className="font-mono text-[9px] text-purple-400/50 uppercase tracking-widest mb-0.5">Bank Address</p>
            <p className="font-mono text-[9px] text-purple-300 break-all">{stepDeploy.result}</p>
            <a href={`https://basescan.org/address/${stepDeploy.result}`} target="_blank" rel="noopener noreferrer"
              className="inline-block mt-1 font-mono text-[9px] text-blue-400 hover:text-blue-300 underline">
              View on Basescan →
            </a>
          </div>
        )}

        {stepDeploy.status !== "done" && (
          <>
            <BankActionButton
              onClick={handleDeployBank}
              state={stepDeploy}
              label="Deploy ZorgBank"
              pendingLabel="Confirm in wallet..."
              confirmingLabel="Confirming on Base..."
              color="#a855f7"
            />
            <div className="flex gap-2 pt-1 border-t border-white/5">
              <input
                value={manualBankAddr}
                onChange={(e) => setManualBankAddr(e.target.value)}
                placeholder="Already deployed? Paste 0x address..."
                className="flex-1 bg-black/40 border border-purple-400/15 rounded px-3 py-2 font-mono text-[10px] text-white focus:outline-none focus:border-purple-400/50 min-h-[44px]"
              />
              <button onClick={handleSaveBank}
                className="px-3 py-2 bg-purple-400/10 border border-purple-400/20 text-purple-400 font-mono text-[10px] rounded hover:bg-purple-400/20 transition-all min-h-[44px]">
                Save
              </button>
            </div>
          </>
        )}
      </BankStepCard>

      {/* Step B: Deposit ZORG */}
      <BankStepCard
        step="B"
        title="Deposit 1B ZORG to Bank"
        state={stepDeposit}
        locked={!canDeposit}
        lockedReason={!tokenAddress ? "Deploy ZORG token first" : "Deploy ZorgBank first"}
      >
        <p className="font-mono text-[9px] text-white/30 leading-relaxed">
          Transfers all 1,000,000,000 ZORG from your wallet into the bank contract. The bank will hold tokens until distribution.
        </p>
        <BankActionButton
          onClick={handleDepositTokens}
          state={stepDeposit}
          label="Transfer 1B ZORG → Bank"
          pendingLabel="Confirm in wallet..."
          confirmingLabel="Confirming on Base..."
          color="#a855f7"
          disabled={!canDeposit}
        />
      </BankStepCard>

      {/* Step C: Verify ZorgBank on Basescan */}
      {bankAddress && (
        <BankVerifyPanel contractAddress={bankAddress} operatorAddress={NEYNAR_WALLET_ADDRESS || DEV_WALLET_ADDRESS} />
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function BankStepCard({
  step, title, state, children, locked, lockedReason,
}: {
  step: string;
  title: string;
  state: StepState;
  children: React.ReactNode;
  locked?: boolean;
  lockedReason?: string;
}) {
  const isDone = state.status === "done";
  return (
    <div className={`rounded-xl border ${isDone ? "border-purple-400/30" : locked ? "border-white/5" : "border-purple-400/15"} bg-[#0a0a0a] p-4 space-y-3 transition-all`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className={`font-mono text-[9px] font-black px-1.5 py-0.5 rounded ${isDone ? "bg-purple-400/20 text-purple-400" : locked ? "bg-white/5 text-white/20" : "bg-purple-400/10 text-purple-400/60"}`}>
            {isDone ? "✓" : step}
          </span>
          <p className={`font-mono text-xs font-bold ${locked ? "text-white/20" : "text-white"}`}>{title}</p>
        </div>
        {isDone && <span className="font-mono text-[9px] text-purple-400 bg-purple-400/10 border border-purple-400/20 px-2 py-0.5 rounded">DONE</span>}
      </div>
      {locked ? (
        <p className="font-mono text-[10px] text-white/20 text-center py-2">{lockedReason}</p>
      ) : children}
      {state.error && (
        <p className="font-mono text-[9px] text-red-400/80 bg-red-400/5 px-3 py-2 rounded break-all">{state.error}</p>
      )}
    </div>
  );
}

function BankActionButton({
  onClick, state, label, pendingLabel, confirmingLabel, color = "#a855f7", disabled,
}: {
  onClick: () => void;
  state: StepState;
  label: string;
  pendingLabel: string;
  confirmingLabel: string;
  color?: string;
  disabled?: boolean;
}) {
  const isPending = state.status === "pending";
  const isConfirming = state.status === "confirming";
  const isProcessing = isPending || isConfirming;
  return (
    <button
      onClick={onClick}
      disabled={disabled || isProcessing}
      className="w-full py-3 rounded-lg font-mono text-xs font-bold tracking-widest uppercase transition-all min-h-[44px] active:scale-95 disabled:cursor-not-allowed"
      style={{
        background: isProcessing ? `${color}22` : color,
        color: isProcessing ? color : "#fff",
        border: isProcessing ? `1px solid ${color}44` : "none",
        opacity: disabled && !isProcessing ? 0.4 : 1,
      }}
    >
      {isPending ? pendingLabel : isConfirming ? confirmingLabel : label}
    </button>
  );
}

// ── BankVerifyPanel ──────────────────────────────────────────────────────────

type VerifyStep = "idle" | "submitting" | "polling" | "done" | "error";

function BankVerifyPanel({
  contractAddress,
  operatorAddress,
}: {
  contractAddress: string;
  operatorAddress: string;
}) {
  const [step, setStep] = useState<VerifyStep>("idle");
  const [message, setMessage] = useState("");
  const [guid, setGuid] = useState<string | null>(null);
  const [copiedSource, setCopiedSource] = useState(false);
  const [copiedArgs, setCopiedArgs] = useState(false);

  // Poll after submission
  useEffect(() => {
    if (step !== "polling" || !guid) return;
    let attempts = 0;
    const MAX = 20;
    const interval = setInterval(async () => {
      attempts++;
      const result = await checkVerifyStatus(guid);
      if (result.status === "pass") {
        clearInterval(interval);
        setStep("done");
        setMessage("ZorgBank verified on Basescan!");
        return;
      }
      if (result.status === "fail") {
        clearInterval(interval);
        setStep("error");
        setMessage(result.message);
        return;
      }
      if (attempts >= MAX) {
        clearInterval(interval);
        setStep("error");
        setMessage("Timed out — verify manually on Basescan");
        return;
      }
      setMessage(`Verifying... (${attempts}/${MAX})`);
    }, 3000);
    return () => clearInterval(interval);
  }, [step, guid]);

  async function handleVerify() {
    setStep("submitting");
    setMessage("Submitting ZorgBank to Basescan...");
    const result = await submitBankVerification(contractAddress, operatorAddress);
    if (result.alreadyVerified) {
      setStep("done");
      setMessage("Already verified on Basescan!");
      return;
    }
    if (!result.success || !result.guid) {
      setStep("error");
      setMessage(result.message);
      return;
    }
    setGuid(result.guid);
    setStep("polling");
    setMessage("Submitted! Waiting for Basescan...");
  }

  function handleRetry() {
    setStep("idle");
    setMessage("");
    setGuid(null);
  }

  function handleCopySource() {
    navigator.clipboard.writeText(ZORG_BANK_SOURCE).then(() => {
      setCopiedSource(true);
      setTimeout(() => setCopiedSource(false), 2500);
    });
  }

  function handleCopyArgs() {
    // Constructor: (address _owner, address _operator)
    try {
      const encoded = encodeAbiParameters(
        parseAbiParameters("address, address"),
        [
          DEV_WALLET_ADDRESS as `0x${string}`,
          operatorAddress as `0x${string}`,
        ]
      );
      navigator.clipboard.writeText(encoded.slice(2)).then(() => {
        setCopiedArgs(true);
        setTimeout(() => setCopiedArgs(false), 2500);
      });
    } catch { /* ignore */ }
  }

  const isDone = step === "done";
  const isError = step === "error";
  const isWorking = step === "submitting" || step === "polling";

  return (
    <div className="rounded-xl border border-purple-400/20 bg-[#0a0a0a] p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`font-mono text-[9px] font-black px-1.5 py-0.5 rounded ${isDone ? "bg-purple-400/20 text-purple-400" : "bg-purple-400/10 text-purple-400/60"}`}>
            {isDone ? "✓" : "C"}
          </span>
          <p className="font-mono text-xs font-bold text-white">Verify ZorgBank on Basescan</p>
        </div>
        {isDone && (
          <span className="font-mono text-[9px] text-purple-400 bg-purple-400/10 border border-purple-400/20 px-2 py-0.5 rounded">VERIFIED</span>
        )}
      </div>

      {/* Compiler details */}
      <div className="bg-black/30 rounded p-3 space-y-1.5">
        {[
          { label: "Contract", value: "ZorgBank" },
          { label: "Compiler", value: "Solidity 0.8.20" },
          { label: "Optimizer", value: "Enabled · 200 runs" },
          { label: "EVM", value: "london" },
          { label: "License", value: "MIT" },
          { label: "Owner arg", value: `${DEV_WALLET_ADDRESS.slice(0, 10)}...` },
          { label: "Operator arg", value: operatorAddress ? `${operatorAddress.slice(0, 10)}...` : "= owner" },
        ].map(({ label, value }) => (
          <div key={label} className="flex justify-between">
            <span className="font-mono text-[9px] text-white/30 uppercase tracking-widest">{label}</span>
            <span className="font-mono text-[9px] text-white/60">{value}</span>
          </div>
        ))}
      </div>

      {/* Status */}
      {message && (
        <p className={`font-mono text-[9px] px-3 py-2 rounded leading-relaxed ${
          isDone ? "text-purple-400/80 bg-purple-400/5 border border-purple-400/20" :
          isError ? "text-red-400/80 bg-red-400/5" :
          "text-purple-400/80 bg-purple-400/5"
        }`}>
          {isWorking && <span className="inline-block mr-1 animate-pulse">●</span>}
          {message}
        </p>
      )}

      {/* Auto-verify */}
      {!isDone && (
        <button
          onClick={isError ? handleRetry : handleVerify}
          disabled={isWorking}
          className="w-full py-3 rounded-lg font-mono text-xs font-bold tracking-widest uppercase transition-all min-h-[44px] active:scale-95 disabled:cursor-not-allowed"
          style={{
            background: isWorking ? "#a855f722" : isError ? "#ef444422" : "#a855f7",
            color: isWorking ? "#a855f7" : isError ? "#ef4444" : "#fff",
            border: isWorking ? "1px solid #a855f744" : isError ? "1px solid #ef444444" : "none",
          }}
        >
          {isWorking
            ? step === "submitting" ? "Submitting..." : "Verifying on Basescan..."
            : isError ? "Retry Auto-Verify"
            : "Verify ZorgBank Automatically"}
        </button>
      )}

      {/* Manual copy helpers */}
      <div className="border-t border-white/5 pt-3 space-y-2">
        <p className="font-mono text-[8px] text-white/20 uppercase tracking-widest">Manual verification</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={handleCopySource}
            className="py-2.5 rounded-lg font-mono text-[10px] font-bold tracking-widest uppercase border border-white/10 text-white/50 hover:text-white hover:border-white/30 transition-all min-h-[44px]"
          >
            {copiedSource ? "Copied!" : "Copy .sol Source"}
          </button>
          <button
            onClick={handleCopyArgs}
            className="py-2.5 rounded-lg font-mono text-[10px] font-bold tracking-widest uppercase border border-white/10 text-white/50 hover:text-white hover:border-white/30 transition-all min-h-[44px]"
          >
            {copiedArgs ? "Copied!" : "Copy ABI Args"}
          </button>
        </div>
        <p className="font-mono text-[8px] text-white/15 leading-relaxed">
          Basescan → Contract → Verify → Solidity (Single file) → 0.8.20 → MIT → Optimizer 200 → EVM: london → paste source → paste ABI args
        </p>
      </div>

      <a
        href={`https://basescan.org/address/${contractAddress}#code`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 w-full py-2 rounded-lg font-mono text-[9px] tracking-widest uppercase border border-purple-400/20 text-purple-400/60 hover:text-purple-300 hover:border-purple-400/40 transition-all"
      >
        Open ZorgBank on Basescan →
      </a>
    </div>
  );
}
