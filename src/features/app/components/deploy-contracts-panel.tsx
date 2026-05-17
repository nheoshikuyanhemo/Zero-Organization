"use client";

import { useState, useEffect } from "react";
import {
  useDeployContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useAccount,
  useSwitchChain,
  useSendTransaction,
  useReadContract,
} from "wagmi";
import { parseUnits, formatEther, encodeFunctionData } from "viem";
import { base } from "viem/chains";
import { kvGet, kvSet } from "@/neynar-db-sdk";
import { runDistribution, retryFailedDistributions, getDistributionStats, getVestingStatus, VestingStatus } from "@/db/actions/distribution-actions";
import {
  DEV_WALLET_ADDRESS,
  USER_TOKEN_POOL,
  LIQUIDITY_TOKEN_POOL,
  DEV_TOKEN_AMOUNT,
  USER_ALLOC_BPS,
  LIQUIDITY_ALLOC_BPS,
  DEV_ALLOC_BPS,
  USER_VESTING_TRANCHES,
  DEV_VESTING_DAYS,
} from "@/features/app/lib/zorg-config";
import {
  ERC20_ABI,
  ERC20_BYTECODE,
  POSITION_MANAGER_ABI,
  UNISWAP_V3_POSITION_MANAGER,
  WETH_BASE,
  BURN_ADDRESS,
  UNISWAP_FEE_TIER,
  SQRT_PRICE_ZORG_WETH,
  RESCUE_ABI,
} from "@/features/app/lib/erc20-abi";
import { BANK_ABI } from "@/features/app/lib/bank-abi";
import {
  submitContractVerification,
  checkVerifyStatus,
} from "@/db/actions/verify-contract-actions";
import { ZORG_TOKEN_SOURCE } from "@/features/app/lib/zorg-token-source";

const ZORG_LOGO = "https://raw.githubusercontent.com/nheoshikuyanhemo/template/refs/heads/main/0xEixa.png";
const TOTAL_SUPPLY = parseUnits("1000000000", 18); // 1B with 18 decimals

// Uniswap V3 tick range for full range liquidity (1% fee tier, spacing 200)
const TICK_LOWER = -887200;
const TICK_UPPER = 887200;

type Step = "idle" | "pending" | "confirming" | "done" | "error";

interface StepState {
  status: Step;
  txHash?: string;
  error?: string;
  result?: string;
}

interface DeployContractsPanelProps {
  currentFid: number;
  onRefresh: () => void;
}

export function DeployContractsPanel({ currentFid, onRefresh }: DeployContractsPanelProps) {
  const { address: walletAddress } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  const [tokenAddress, setTokenAddress] = useState<string | null>(null);
  const [bankAddress, setBankAddress] = useState<string | null>(null);
  const [lpTokenId, setLpTokenId] = useState<string | null>(null);
  const [manualAddress, setManualAddress] = useState("");
  const [distStats, setDistStats] = useState<{ total: number; paid: number; failed: number; pending: number } | null>(null);
  const [vestingStatus, setVestingStatus] = useState<VestingStatus | null>(null);
  const [rescueTokenAddr, setRescueTokenAddr] = useState("");
  const [rescueStatus, setRescueStatus] = useState("");

  // ── Live bank balances from chain ─────────────────────────────────────────
  const { data: bankEthBalanceRaw, refetch: refetchBankEth } = useReadContract({
    address: bankAddress as `0x${string}` | undefined,
    abi: BANK_ABI,
    functionName: "ethBalance",
    query: { enabled: !!bankAddress, refetchInterval: 15_000 },
  });
  const { data: bankZorgBalanceRaw, refetch: refetchBankZorg } = useReadContract({
    address: bankAddress as `0x${string}` | undefined,
    abi: BANK_ABI,
    functionName: "tokenBalance",
    args: tokenAddress ? [tokenAddress as `0x${string}`] : undefined,
    query: { enabled: !!bankAddress && !!tokenAddress, refetchInterval: 15_000 },
  });

  // Derived human-readable values
  const bankEthBalance: bigint = (bankEthBalanceRaw as bigint | undefined) ?? BigInt(0);
  const bankZorgBalance: bigint = (bankZorgBalanceRaw as bigint | undefined) ?? BigInt(0);
  const bankEthFmt = Number(formatEther(bankEthBalance)).toFixed(6);
  const bankZorgFmt = bankZorgBalance > BigInt(0)
    ? (Number(bankZorgBalance) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 0 })
    : "—";

  const [step1, setStep1] = useState<StepState>({ status: "idle" });
  const [step2, setStep2] = useState<StepState>({ status: "idle" });
  const [step3, setStep3] = useState<StepState>({ status: "idle" });
  const [step4, setStep4] = useState<StepState>({ status: "idle" });

  // ── Wagmi hooks ────────────────────────────────────────────────────────────

  const { deployContract, data: deployHash, isPending: deployPending, error: deployError } = useDeployContract();
  const { isLoading: deployConfirming, isSuccess: deploySuccess, data: deployReceipt } =
    useWaitForTransactionReceipt({ hash: deployHash });

  // Step 3b: Atomic multicall — init pool + mint LP + refundETH
  const { sendTransaction: sendLiquidityTx, data: mintHash, isPending: mintPending } = useSendTransaction();
  const { isLoading: mintConfirming, isSuccess: mintSuccess, data: mintReceipt } =
    useWaitForTransactionReceipt({ hash: mintHash });

  const { writeContract: writeBurn, data: burnHash, isPending: burnPending } = useWriteContract();
  const { isLoading: burnConfirming, isSuccess: burnSuccess } =
    useWaitForTransactionReceipt({ hash: burnHash });

  // Rescue hooks
  const { writeContract: writeRescueETH, data: rescueEthHash, isPending: rescueEthPending } = useWriteContract();
  const { writeContract: writeRescueTokens, data: rescueTokensHash, isPending: rescueTokensPending } = useWriteContract();
  const { isSuccess: rescueEthSuccess } = useWaitForTransactionReceipt({ hash: rescueEthHash });
  const { isSuccess: rescueTokensSuccess } = useWaitForTransactionReceipt({ hash: rescueTokensHash });

  // ── Load persisted state ───────────────────────────────────────────────────

  useEffect(() => {
    async function loadState() {
      const [addr, bankAddr, lpId, ds, vs] = await Promise.all([
        kvGet("zorg:token_address"),
        kvGet("zorg:bank_address"),
        kvGet("zorg:lp_token_id"),
        getDistributionStats(),
        getVestingStatus(),
      ]);
      setTokenAddress(addr);
      setBankAddress(bankAddr);
      setLpTokenId(lpId);
      setDistStats(ds);
      setVestingStatus(vs);
      if (addr) setStep1({ status: "done", result: addr });
      if (lpId) setStep3({ status: "done", result: `LP NFT #${lpId}` });
      if (lpId && await kvGet("zorg:lp_burned")) setStep4({ status: "done", result: "LP burned" });
    }
    loadState();
  }, []);

  // ── Step 1 effects ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (deployPending) setStep1({ status: "pending" });
    if (deployHash && deployConfirming) setStep1({ status: "confirming", txHash: deployHash });
  }, [deployPending, deployHash, deployConfirming]);

  useEffect(() => {
    if (!deploySuccess || !deployReceipt?.contractAddress) return;
    const addr = deployReceipt.contractAddress;
    kvSet("zorg:token_address", addr).then(() => {
      setTokenAddress(addr);
      setStep1({ status: "done", result: addr, txHash: deployReceipt.transactionHash });
      onRefresh();
    });
  }, [deploySuccess, deployReceipt]);

  useEffect(() => {
    if (!deployError) return;
    const msg = deployError.message ?? "";
    if (!msg.toLowerCase().includes("rejected")) {
      setStep1({ status: "error", error: msg.slice(0, 120) });
    } else {
      setStep1({ status: "idle" });
    }
  }, [deployError]);

  // ── Step 3 effects ─────────────────────────────────────────────────────────
  // LP flow with bank:
  //   1. writeApprove → bank.approveToken(ZORG, PositionManager, lpAmount)
  //   2. approveSuccess → writeBankWithdrawEth → bank.withdrawAllETH(adminWallet)
  //   3. withdrawEthSuccess → sendLiquidityMulticall (admin wallet has ETH now)

  const { writeContract: writeBankApprove, data: bankApproveHash, isPending: bankApprovePending } = useWriteContract();
  const { isLoading: bankApproveConfirming, isSuccess: bankApproveSuccess } =
    useWaitForTransactionReceipt({ hash: bankApproveHash });

  const { writeContract: writeBankWithdrawEth, data: withdrawEthHash, isPending: withdrawEthPending } = useWriteContract();
  const { isLoading: withdrawEthConfirming, isSuccess: withdrawEthSuccess } =
    useWaitForTransactionReceipt({ hash: withdrawEthHash });

  // Bank approve done → withdraw ETH from bank to admin wallet
  useEffect(() => {
    if (bankApproveSuccess && bankAddress && walletAddress) {
      setStep3({ status: "pending" });
      writeBankWithdrawEth({
        address: bankAddress as `0x${string}`,
        abi: BANK_ABI,
        functionName: "withdrawAllETH",
        args: [walletAddress],
        chainId: base.id,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankApproveSuccess]);

  // ETH withdrawn to admin wallet → fire multicall
  useEffect(() => {
    if (withdrawEthSuccess && tokenAddress && walletAddress) {
      setStep3({ status: "pending" });
      // Refresh balance then trigger multicall
      refetchBankEth().then(() => {
        sendLiquidityMulticall().catch((err) => {
          setStep3({ status: "error", error: err instanceof Error ? err.message.slice(0, 100) : "Liquidity tx failed" });
        });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withdrawEthSuccess]);

  useEffect(() => {
    if (mintHash && mintConfirming) setStep3({ status: "confirming", txHash: mintHash });
  }, [mintHash, mintConfirming]);

  useEffect(() => {
    if (!mintSuccess || !mintReceipt) return;
    const tokenId = extractLpTokenId(mintReceipt.logs);
    const id = tokenId?.toString() ?? "unknown";
    kvSet("zorg:lp_token_id", id).then(() => {
      setLpTokenId(id);
      setStep3({ status: "done", result: `LP NFT #${id}`, txHash: mintReceipt.transactionHash });
      onRefresh();
    });
  }, [mintSuccess, mintReceipt]);

  // ── Step 4 effects ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (burnPending) setStep4({ status: "pending" });
    if (burnHash && burnConfirming) setStep4({ status: "confirming", txHash: burnHash });
  }, [burnPending, burnHash, burnConfirming]);

  useEffect(() => {
    if (!burnSuccess) return;
    kvSet("zorg:lp_burned", "true").then(() => {
      setStep4({ status: "done", result: "LP NFT burned to dead address", txHash: burnHash });
      onRefresh();
    });
  }, [burnSuccess]);

  // ── Rescue effects ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (rescueEthSuccess) setRescueStatus("ETH rescued successfully!");
  }, [rescueEthSuccess]);

  useEffect(() => {
    if (rescueTokensSuccess) setRescueStatus("Tokens rescued successfully!");
  }, [rescueTokensSuccess]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  async function handleDeployToken() {
    if (!walletAddress) { setStep1({ status: "error", error: "Connect wallet first" }); return; }
    try {
      await switchChainAsync({ chainId: base.id });
      setStep1({ status: "pending" });
      deployContract({
        abi: ERC20_ABI,
        bytecode: ERC20_BYTECODE,
        args: ["Zero Organization", "ZORG", TOTAL_SUPPLY, DEV_WALLET_ADDRESS as `0x${string}`],
        chainId: base.id,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error";
      if (!msg.toLowerCase().includes("rejected")) setStep1({ status: "error", error: msg.slice(0, 100) });
      else setStep1({ status: "idle" });
    }
  }

  async function handleDistribute() {
    setStep2({ status: "pending" });
    try {
      const result = await runDistribution(currentFid);
      if ("error" in result) {
        setStep2({ status: "error", error: result.error });
        return;
      }
      const [ds, vs] = await Promise.all([getDistributionStats(), getVestingStatus()]);
      setDistStats(ds);
      setVestingStatus(vs);
      const trancheLabel = result.tranche ? ` · Tranche ${result.tranche}/${USER_VESTING_TRANCHES}` : "";
      const devLabel = result.devDaysSent ? ` · Dev +${result.devDaysSent}d` : "";
      setStep2({
        status: "done",
        result: `${result.sent} sent · ${result.failed} failed · ${result.skipped} skipped${trancheLabel}${devLabel}`,
      });
      onRefresh();
    } catch (err) {
      setStep2({ status: "error", error: err instanceof Error ? err.message : "unknown" });
    }
  }

  async function handleRetryDistribute() {
    setStep2({ status: "pending" });
    try {
      const result = await retryFailedDistributions(currentFid);
      if ("error" in result) { setStep2({ status: "error", error: result.error }); return; }
      const [ds, vs] = await Promise.all([getDistributionStats(), getVestingStatus()]);
      setDistStats(ds);
      setVestingStatus(vs);
      setStep2({ status: "done", result: `Retry: ${result.sent} sent · ${result.failed} failed` });
      onRefresh();
    } catch (err) {
      setStep2({ status: "error", error: err instanceof Error ? err.message : "unknown" });
    }
  }

  async function handleAddLiquidity() {
    if (!walletAddress || !tokenAddress || !bankAddress) return;
    try {
      await switchChainAsync({ chainId: base.id });
      setStep3({ status: "pending" });

      // Use real on-chain bank balances
      // If bank has no ZORG yet fall back to LP pool constant; ETH must be > 0
      const zorgAmount = bankZorgBalance > BigInt(0)
        ? (bankZorgBalance * BigInt(LIQUIDITY_ALLOC_BPS)) / BigInt(10000)  // 25% of bank's ZORG
        : parseUnits(Number(LIQUIDITY_TOKEN_POOL).toString(), 18);

      const ethAmount = bankEthBalance > BigInt(0)
        ? bankEthBalance  // ALL ETH in bank goes to LP
        : BigInt("1000000000000000"); // 0.001 ETH fallback (should never happen)

      // Determine token0/token1 order (Uniswap requires lower address first)
      const isZorgToken0 = tokenAddress.toLowerCase() < WETH_BASE.toLowerCase();
      const token0 = isZorgToken0 ? tokenAddress as `0x${string}` : WETH_BASE;
      const token1 = isZorgToken0 ? WETH_BASE : tokenAddress as `0x${string}`;

      // Persist LP params for use in the multicall callback (after ETH arrives in wallet)
      await Promise.all([
        kvSet("zorg:lp_token0", token0),
        kvSet("zorg:lp_token1", token1),
        kvSet("zorg:lp_is_zorg_token0", isZorgToken0.toString()),
        kvSet("zorg:lp_zorg_amount", zorgAmount.toString()),
        kvSet("zorg:lp_eth_amount", ethAmount.toString()),
      ]);

      // Step 1 of 3: approve ZORG from ZorgBank to Uniswap PositionManager
      // bank.approveToken(zorgToken, positionManager, zorgAmount)
      writeBankApprove({
        address: bankAddress as `0x${string}`,
        abi: BANK_ABI,
        functionName: "approveToken",
        args: [tokenAddress as `0x${string}`, UNISWAP_V3_POSITION_MANAGER, zorgAmount],
        chainId: base.id,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error";
      if (!msg.toLowerCase().includes("rejected")) setStep3({ status: "error", error: msg.slice(0, 100) });
      else setStep3({ status: "idle" });
    }
  }

  /**
   * Atomic multicall — called AFTER bank.withdrawAllETH has confirmed and
   * admin wallet now holds the real ETH from the bank.
   *
   * 1. createAndInitializePoolIfNecessary — creates ZORG/WETH pool
   * 2. mint — adds full-range liquidity (ZORG approved from bank, ETH from wallet)
   * 3. refundETH — returns any unspent ETH to admin wallet
   *
   * ZORG flows: ZorgBank → (approved) → Uniswap PositionManager (pulled on mint)
   * ETH flows:  ZorgBank → withdrawAllETH → admin wallet → tx value → PositionManager
   */
  async function sendLiquidityMulticall() {
    if (!walletAddress) return;

    const [token0Raw, token1Raw, isZorgT0Raw, zorgAmtRaw, ethAmtRaw] = await Promise.all([
      kvGet("zorg:lp_token0"),
      kvGet("zorg:lp_token1"),
      kvGet("zorg:lp_is_zorg_token0"),
      kvGet("zorg:lp_zorg_amount"),
      kvGet("zorg:lp_eth_amount"),
    ]);

    if (!token0Raw || !token1Raw || !zorgAmtRaw || !ethAmtRaw) {
      throw new Error("LP params missing — retry from Add Liquidity step");
    }

    const isZorgToken0 = isZorgT0Raw === "true";
    const zorgAmount = BigInt(zorgAmtRaw);
    const ethAmount = BigInt(ethAmtRaw);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200); // 20 min

    const amount0Desired = isZorgToken0 ? zorgAmount : ethAmount;
    const amount1Desired = isZorgToken0 ? ethAmount : zorgAmount;

    // sqrtPriceX96: SQRT_PRICE_ZORG_WETH is for ZORG-as-token0.
    // If WETH is token0, invert the price: 2^192 / (sqrtPrice^2)
    const sqrtPriceX96 = isZorgToken0
      ? SQRT_PRICE_ZORG_WETH
      : (BigInt(2) ** BigInt(192)) / (SQRT_PRICE_ZORG_WETH * SQRT_PRICE_ZORG_WETH);

    const initPoolData = encodeFunctionData({
      abi: POSITION_MANAGER_ABI,
      functionName: "createAndInitializePoolIfNecessary",
      args: [token0Raw as `0x${string}`, token1Raw as `0x${string}`, UNISWAP_FEE_TIER, sqrtPriceX96],
    });

    const mintData = encodeFunctionData({
      abi: POSITION_MANAGER_ABI,
      functionName: "mint",
      args: [{
        token0: token0Raw as `0x${string}`,
        token1: token1Raw as `0x${string}`,
        fee: UNISWAP_FEE_TIER,
        tickLower: TICK_LOWER,
        tickUpper: TICK_UPPER,
        amount0Desired,
        amount1Desired,
        amount0Min: 0n,
        amount1Min: 0n,
        recipient: walletAddress,
        deadline,
      }],
    });

    const refundData = encodeFunctionData({
      abi: POSITION_MANAGER_ABI,
      functionName: "refundETH",
      args: [],
    });

    const multicallData = encodeFunctionData({
      abi: POSITION_MANAGER_ABI,
      functionName: "multicall",
      args: [[initPoolData, mintData, refundData]],
    });

    sendLiquidityTx({
      to: UNISWAP_V3_POSITION_MANAGER,
      data: multicallData,
      value: ethAmount, // Position Manager wraps ETH → WETH internally
      chainId: base.id,
    });
  }

  async function handleBurnLp() {
    if (!walletAddress || !lpTokenId) return;
    try {
      await switchChainAsync({ chainId: base.id });
      setStep4({ status: "pending" });
      writeBurn({
        address: UNISWAP_V3_POSITION_MANAGER,
        abi: POSITION_MANAGER_ABI,
        functionName: "transferFrom",
        args: [walletAddress, BURN_ADDRESS, BigInt(lpTokenId)],
        chainId: base.id,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error";
      if (!msg.toLowerCase().includes("rejected")) setStep4({ status: "error", error: msg.slice(0, 100) });
      else setStep4({ status: "idle" });
    }
  }

  async function handleSaveAddress() {
    const addr = manualAddress.trim();
    if (!addr.startsWith("0x") || addr.length !== 42) {
      setStep1({ status: "error", error: "Invalid address — must be 0x + 40 hex chars" });
      return;
    }
    await kvSet("zorg:token_address", addr);
    setTokenAddress(addr);
    setStep1({ status: "done", result: addr });
    onRefresh();
  }

  function handleRescueETH() {
    if (!tokenAddress) return;
    setRescueStatus("Confirm in wallet...");
    writeRescueETH({
      address: tokenAddress as `0x${string}`,
      abi: RESCUE_ABI,
      functionName: "rescueETH",
      chainId: base.id,
    });
  }

  function handleRescueTokens() {
    const addr = rescueTokenAddr.trim();
    if (!addr.startsWith("0x") || addr.length !== 42) {
      setRescueStatus("Invalid token address");
      return;
    }
    if (!tokenAddress) return;
    setRescueStatus("Confirm in wallet...");
    writeRescueTokens({
      address: tokenAddress as `0x${string}`,
      abi: RESCUE_ABI,
      functionName: "rescueTokens",
      args: [addr as `0x${string}`],
      chainId: base.id,
    });
  }

  // ── Derived state ──────────────────────────────────────────────────────────

  // New flow: Deploy → Add Liquidity (LP pair first) → Distribute → Burn LP NFT
  const canAddLiquidity = !!tokenAddress; // unlocked as soon as token is deployed
  const canDistribute = !!tokenAddress && (step3.status === "done" || !!lpTokenId); // after LP created
  const canBurnLp = !!lpTokenId && (step2.status === "done" || distStats?.paid != null); // after distribution

  return (
    <div className="space-y-3">

      {/* ── STEP 1: Deploy Token ── */}
      <StepCard
        step={1}
        title="Deploy $ZORG Token"
        subtitle="ERC-20 · 1,000,000,000 supply · Base"
        state={step1}
      >
        <div className="flex items-center gap-3 bg-black/40 rounded-lg p-3 border border-[#00ff41]/10">
          <img
            src={ZORG_LOGO}
            alt="ZORG"
            className="w-10 h-10 rounded-full object-cover border border-[#00ff41]/30 shrink-0"
            style={{ boxShadow: "0 0 6px rgba(0,255,65,0.3)" }}
          />
          <div>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-sm font-black text-[#00ff41]" style={{ textShadow: "0 0 6px #00ff41" }}>$ZORG</span>
              <span className="font-mono text-[9px] text-white/30 uppercase tracking-widest">ERC-20 · Base</span>
            </div>
            <p className="font-mono text-[10px] text-white/40">Zero Organization · 1,000,000,000</p>
          </div>
          {step1.status === "done" && (
            <span className="ml-auto font-mono text-[9px] text-[#00ff41] bg-[#00ff41]/10 border border-[#00ff41]/30 px-2 py-0.5 rounded shrink-0">LIVE</span>
          )}
        </div>

        {step1.status === "done" && step1.result && (
          <div className="bg-black/40 rounded px-3 py-2 border border-[#00ff41]/20">
            <p className="font-mono text-[9px] text-[#00ff41]/40 uppercase tracking-widest mb-0.5">Contract Address</p>
            <p className="font-mono text-[9px] text-[#00ff41] break-all">{step1.result}</p>
            <a
              href={`https://basescan.org/address/${step1.result}#code`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-2 font-mono text-[9px] text-blue-400 hover:text-blue-300 underline"
            >
              View on Basescan →
            </a>
          </div>
        )}

        {step1.status !== "done" && (
          <>
            <ActionButton
              onClick={handleDeployToken}
              state={step1}
              label="Deploy $ZORG on Base"
              pendingLabel="Confirm in wallet..."
              confirmingLabel="Confirming on Base..."
              disabled={step1.status === "pending" || step1.status === "confirming"}
            />
            <div className="flex gap-2 pt-1 border-t border-white/5">
              <input
                value={manualAddress}
                onChange={(e) => setManualAddress(e.target.value)}
                placeholder="Already deployed? Paste 0x address..."
                className="flex-1 bg-black/40 border border-[#00ff41]/15 rounded px-3 py-2 font-mono text-[10px] text-white focus:outline-none focus:border-[#00ff41]/50 min-h-[44px]"
              />
              <button
                onClick={handleSaveAddress}
                className="px-3 py-2 bg-[#00ff41]/10 border border-[#00ff41]/20 text-[#00ff41] font-mono text-[10px] rounded hover:bg-[#00ff41]/20 transition-all min-h-[44px]"
              >
                Save
              </button>
            </div>
          </>
        )}
      </StepCard>

      {/* ── STEP 2: Add Uniswap V3 Liquidity (BEFORE user distribution) ── */}
      <StepCard
        step={2}
        title="Add Uniswap V3 Liquidity"
        subtitle={`ZORG/ETH · ${bankEthFmt} ETH (bank) · 25% ZORG · Full range`}
        state={step3}
        locked={!canAddLiquidity}
        lockedReason="Deploy token first"
      >
        {/* Live bank balances */}
        {bankAddress && (
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-black/40 rounded-lg p-2.5 border border-[#00ffaa]/10">
              <p className="font-mono text-[8px] text-white/30 uppercase tracking-widest mb-0.5">Bank ZORG</p>
              <p className="font-mono text-xs font-black text-[#00ffaa]">{bankZorgFmt}</p>
            </div>
            <div className="bg-black/40 rounded-lg p-2.5 border border-[#00ffaa]/10">
              <p className="font-mono text-[8px] text-white/30 uppercase tracking-widest mb-0.5">Bank ETH</p>
              <p className="font-mono text-xs font-black text-[#00ffaa]">{bankEthFmt}</p>
            </div>
          </div>
        )}

        <div className="space-y-1 bg-black/30 rounded p-3">
          <p className="font-mono text-[9px] text-[#00ffaa]/60 mb-1">
            ✓ LP pair first — ZORG approved from bank, ETH withdrawn from bank to your wallet, then multicall mints LP.
          </p>
          {[
            { label: "ZORG Source", value: "ZorgBank (25% of bank balance)", color: "text-[#00ffaa]" },
            { label: "ETH Source", value: `ZorgBank → wallet (${bankEthFmt} ETH)`, color: "text-[#00ffaa]" },
            { label: "Fee Tier", value: "1% (10000)", color: "text-white/60" },
            { label: "Range", value: "Full range", color: "text-white/60" },
            { label: "Method", value: "Bank approve + withdraw → multicall", color: "text-white/60" },
            { label: "DEX", value: "Uniswap V3 · Base", color: "text-white/60" },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex justify-between">
              <span className="font-mono text-[10px] text-white/40">{label}</span>
              <span className={`font-mono text-[10px] font-bold ${color}`}>{value}</span>
            </div>
          ))}
        </div>

        {step3.status === "pending" && (
          <p className="font-mono text-[9px] text-[#00ff41]/60 text-center animate-pulse">
            {bankApprovePending || bankApproveHash && bankApproveConfirming
              ? "Step 1/3 — Approving ZORG from bank..."
              : withdrawEthPending || withdrawEthHash && withdrawEthConfirming
              ? "Step 2/3 — Withdrawing ETH from bank to wallet..."
              : "Step 3/3 — Initializing pool + adding liquidity..."}
          </p>
        )}

        {step3.status === "done" && step3.result && (
          <div className="bg-black/40 rounded px-3 py-2 border border-[#00ffaa]/20">
            <p className="font-mono text-[9px] text-[#00ffaa]/60 uppercase tracking-widest mb-0.5">Position</p>
            <p className="font-mono text-[10px] text-[#00ffaa]">{step3.result}</p>
          </div>
        )}

        {step3.status !== "done" && (
          <ActionButton
            onClick={handleAddLiquidity}
            state={step3}
            label="Add Liquidity from ZorgBank"
            pendingLabel={
              bankApprovePending || (bankApproveHash && bankApproveConfirming)
                ? "Approving ZORG from bank..."
                : withdrawEthPending || (withdrawEthHash && withdrawEthConfirming)
                ? "Withdrawing ETH to wallet..."
                : mintPending || (mintHash && mintConfirming)
                ? "Adding liquidity..."
                : "Processing..."
            }
            confirmingLabel="Confirming on Base..."
            disabled={!canAddLiquidity || !bankAddress || step3.status === "pending" || step3.status === "confirming"}
            color="#00ffaa"
          />
        )}
        {canAddLiquidity && !bankAddress && (
          <p className="font-mono text-[9px] text-yellow-400/60 text-center">
            Deploy ZorgBank first to use real bank balances
          </p>
        )}
      </StepCard>

      {/* ── STEP 3: Vested Distribution ── */}
      <StepCard
        step={3}
        title="Vested Distribution"
        subtitle={`Users: 6 monthly tranches · Dev: linear 360-day vesting`}
        state={step2}
        locked={!canDistribute}
        lockedReason="Add liquidity first"
      >
        {/* Allocation overview */}
        <div className="space-y-1.5">
          {[
            { label: "Users (70%)", amount: `${(Number(USER_TOKEN_POOL) / 1e6).toFixed(0)}M`, color: "#00ff41", sub: "6 monthly tranches" },
            { label: "Dev (5%)", amount: `${(Number(DEV_TOKEN_AMOUNT) / 1e6).toFixed(0)}M`, color: "#39ff14", sub: "360-day linear vesting" },
            { label: "LP (25%)", amount: `${(Number(LIQUIDITY_TOKEN_POOL) / 1e6).toFixed(0)}M ✓`, color: "#00ffaa", sub: "Seeded at LP step" },
          ].map((a) => (
            <div key={a.label} className="flex items-center justify-between bg-black/30 rounded px-3 py-1.5">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: a.color }} />
                <div>
                  <span className="font-mono text-[10px] text-white/60">{a.label}</span>
                  <span className="font-mono text-[8px] text-white/25 ml-1.5">{a.sub}</span>
                </div>
              </div>
              <span className="font-mono text-[10px] font-bold" style={{ color: a.color }}>{a.amount}</span>
            </div>
          ))}
          <div className="flex rounded overflow-hidden h-1 gap-px mt-1">
            <div style={{ width: "70%", background: "#00ff41" }} />
            <div style={{ width: "5%", background: "#39ff14" }} />
            <div style={{ width: "25%", background: "#00ffaa" }} />
          </div>
        </div>

        {/* User vesting tranche progress */}
        {vestingStatus && (
          <div className="bg-black/30 rounded p-3 space-y-2.5">
            {/* User tranches */}
            <div>
              <div className="flex justify-between mb-1">
                <span className="font-mono text-[9px] text-[#00ff41]/60 uppercase tracking-widest">User Tranches</span>
                <span className="font-mono text-[9px] text-[#00ff41]">
                  {vestingStatus.userTrancheSent}/{USER_VESTING_TRANCHES} sent
                  {vestingStatus.userVestingComplete ? " ✓" : ` · Next: #${vestingStatus.userTrancheNext}`}
                </span>
              </div>
              <div className="flex gap-0.5">
                {Array.from({ length: USER_VESTING_TRANCHES }, (_, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-sm h-2 transition-all"
                    style={{
                      background: i < vestingStatus.userTrancheSent ? "#00ff41" : "#00ff4118",
                      border: i === vestingStatus.userTrancheSent ? "1px solid #00ff4166" : "none",
                    }}
                  />
                ))}
              </div>
              <div className="flex justify-between mt-0.5">
                <span className="font-mono text-[7px] text-white/20">Month 1</span>
                <span className="font-mono text-[7px] text-white/20">Month 6</span>
              </div>
            </div>

            {/* Dev vesting */}
            <div>
              <div className="flex justify-between mb-1">
                <span className="font-mono text-[9px] text-[#39ff14]/60 uppercase tracking-widest">Dev Vesting</span>
                <span className="font-mono text-[9px] text-[#39ff14]">
                  {vestingStatus.devDaysClaimed}/{DEV_VESTING_DAYS}d
                  {vestingStatus.devVestingComplete ? " ✓" : ` · ${vestingStatus.devDaysClaimable}d claimable`}
                </span>
              </div>
              <div className="relative w-full h-2 rounded-sm bg-[#39ff1418] overflow-hidden">
                <div
                  className="absolute left-0 top-0 h-full rounded-sm transition-all"
                  style={{ width: `${(vestingStatus.devDaysClaimed / DEV_VESTING_DAYS) * 100}%`, background: "#39ff14" }}
                />
                {vestingStatus.devDaysClaimable > 0 && (
                  <div
                    className="absolute top-0 h-full rounded-sm"
                    style={{
                      left: `${(vestingStatus.devDaysClaimed / DEV_VESTING_DAYS) * 100}%`,
                      width: `${(vestingStatus.devDaysClaimable / DEV_VESTING_DAYS) * 100}%`,
                      background: "#39ff1466",
                    }}
                  />
                )}
              </div>
              {!vestingStatus.devVestingComplete && vestingStatus.devDaysClaimable > 0 && (
                <p className="font-mono text-[8px] text-[#39ff14]/40 mt-0.5">
                  ~{vestingStatus.devTokensClaimable} ZORG claimable now
                </p>
              )}
            </div>
          </div>
        )}

        {/* Distribution stats */}
        {distStats && distStats.total > 0 && (
          <div className="grid grid-cols-4 gap-1 bg-black/30 rounded p-2">
            {[
              { label: "Total", value: distStats.total, color: "text-white" },
              { label: "Sent", value: distStats.paid, color: "text-[#00ff41]" },
              { label: "Pending", value: distStats.pending, color: "text-yellow-400" },
              { label: "Failed", value: distStats.failed, color: distStats.failed > 0 ? "text-red-400" : "text-white/30" },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <p className="font-mono text-[8px] text-white/30 uppercase">{s.label}</p>
                <p className={`font-mono text-sm font-black ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>
        )}

        <ActionButton
          onClick={handleDistribute}
          state={step2}
          label={
            vestingStatus?.userVestingComplete && vestingStatus?.devDaysClaimable === 0
              ? "All Vesting Complete"
              : vestingStatus
              ? vestingStatus.userTrancheSent < USER_VESTING_TRANCHES
                ? `Send Tranche ${vestingStatus.userTrancheSent + 1}/${USER_VESTING_TRANCHES} + Dev Vesting`
                : `Claim Dev Vesting (+${vestingStatus.devDaysClaimable}d)`
              : "Run Distribution"
          }
          pendingLabel="Distributing..."
          confirmingLabel="Processing..."
          disabled={
            !canDistribute ||
            step2.status === "pending" ||
            (vestingStatus?.userVestingComplete === true && vestingStatus?.devDaysClaimable === 0)
          }
          glow
        />

        {distStats && distStats.failed > 0 && (
          <button
            onClick={handleRetryDistribute}
            className="w-full py-2 rounded-lg font-mono text-[10px] font-bold tracking-widest uppercase border border-red-400/30 text-red-400 hover:bg-red-400/10 transition-all min-h-[44px]"
          >
            Retry {distStats.failed} Failed
          </button>
        )}
      </StepCard>

      {/* ── STEP 4: Burn LP NFT ── */}
      <StepCard
        step={4}
        title="Burn LP Position"
        subtitle="Send LP NFT to 0x000...dEaD — locks liquidity permanently"
        state={step4}
        locked={!canBurnLp}
        lockedReason="Complete distribution first"
      >
        <div className="bg-black/30 rounded p-3 space-y-1">
          <div className="flex justify-between">
            <span className="font-mono text-[10px] text-white/40">LP Token ID</span>
            <span className="font-mono text-[10px] text-white/60">#{lpTokenId ?? "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-mono text-[10px] text-white/40">Burn Address</span>
            <span className="font-mono text-[10px] text-white/40">0x000...dEaD</span>
          </div>
          <p className="font-mono text-[9px] text-orange-400/60 mt-1">
            ⚠ Irreversible — LP tokens will be permanently locked.
          </p>
        </div>

        {step4.status === "done" ? (
          <div className="flex items-center justify-center gap-2 py-2">
            <span className="text-orange-400 text-lg">🔥</span>
            <span className="font-mono text-xs text-orange-400">LP burned — liquidity locked forever</span>
          </div>
        ) : (
          <ActionButton
            onClick={handleBurnLp}
            state={step4}
            label="🔥 Burn LP NFT"
            pendingLabel="Confirm in wallet..."
            confirmingLabel="Burning..."
            disabled={!canBurnLp || step4.status === "pending" || step4.status === "confirming"}
            color="#ff6600"
          />
        )}
      </StepCard>

      {/* ── Contract Verification ── */}
      {tokenAddress && (
        <VerifyPanel contractAddress={tokenAddress} />
      )}

      {/* ── Emergency Rescue ── */}
      {tokenAddress && (
        <div className="rounded-xl border border-orange-400/20 bg-[#0a0a0a] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[9px] font-black px-1.5 py-0.5 rounded bg-orange-400/10 text-orange-400">!</span>
            <p className="font-mono text-xs font-bold text-white">Emergency Rescue</p>
          </div>
          <p className="font-mono text-[9px] text-white/30 leading-relaxed">
            If ETH or tokens are accidentally sent to the ZORG contract address, the owner can recover them here.
          </p>

          <button
            onClick={handleRescueETH}
            disabled={rescueEthPending}
            className="w-full py-2.5 rounded-lg font-mono text-[10px] font-bold tracking-widest uppercase border border-orange-400/30 text-orange-400 hover:bg-orange-400/10 transition-all min-h-[44px] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {rescueEthPending ? "Confirm in wallet..." : "Rescue ETH from Contract"}
          </button>

          <div className="flex gap-2">
            <input
              value={rescueTokenAddr}
              onChange={(e) => setRescueTokenAddr(e.target.value)}
              placeholder="Token address to rescue (0x...)"
              className="flex-1 bg-black/40 border border-orange-400/15 rounded px-3 py-2 font-mono text-[10px] text-white focus:outline-none focus:border-orange-400/50 min-h-[44px]"
            />
            <button
              onClick={handleRescueTokens}
              disabled={rescueTokensPending}
              className="px-3 py-2 bg-orange-400/10 border border-orange-400/20 text-orange-400 font-mono text-[10px] rounded hover:bg-orange-400/20 transition-all min-h-[44px] whitespace-nowrap disabled:opacity-40"
            >
              Rescue Tokens
            </button>
          </div>

          {rescueStatus && (
            <p className={`font-mono text-[9px] px-3 py-2 rounded ${
              rescueStatus.includes("successfully") ? "text-[#00ff41]/70 bg-[#00ff41]/5" :
              rescueStatus.startsWith("Invalid") ? "text-red-400/70 bg-red-400/5" :
              "text-orange-400/70 bg-orange-400/5"
            }`}>{rescueStatus}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Verify on Basescan ─────────────────────────────────────────────────────

type VerifyStep = "idle" | "submitting" | "polling" | "done" | "error";

function VerifyPanel({ contractAddress }: { contractAddress: string }) {
  const [step, setStep] = useState<VerifyStep>("idle");
  const [message, setMessage] = useState("");
  const [guid, setGuid] = useState<string | null>(null);
  const [copiedSource, setCopiedSource] = useState(false);
  const [copiedArgs, setCopiedArgs] = useState(false);

  // Poll for verification status after submission
  useEffect(() => {
    if (step !== "polling" || !guid) return;
    let attempts = 0;
    const MAX_ATTEMPTS = 20; // ~60s max polling

    const interval = setInterval(async () => {
      attempts++;
      const result = await checkVerifyStatus(guid);

      if (result.status === "pass") {
        clearInterval(interval);
        setStep("done");
        setMessage("Contract verified on Basescan!");
        return;
      }

      if (result.status === "fail") {
        clearInterval(interval);
        setStep("error");
        setMessage(result.message);
        return;
      }

      if (attempts >= MAX_ATTEMPTS) {
        clearInterval(interval);
        setStep("error");
        setMessage("Timed out — check Basescan manually");
        return;
      }

      setMessage(`Verifying... (${attempts}/${MAX_ATTEMPTS})`);
    }, 3000);

    return () => clearInterval(interval);
  }, [step, guid]);

  async function handleVerify() {
    setStep("submitting");
    setMessage("Submitting to Basescan...");
    const result = await submitContractVerification(contractAddress);
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
    navigator.clipboard.writeText(ZORG_TOKEN_SOURCE).then(() => {
      setCopiedSource(true);
      setTimeout(() => setCopiedSource(false), 2500);
    });
  }

  function handleCopyArgs() {
    // ABI-encode constructor args for manual Basescan verification
    // (string name, string symbol, uint256 totalSupply, address owner)
    // We build the hex manually to avoid importing viem encode here
    // Basescan expects raw hex without 0x
    try {
      // Use dynamic import trick: encode via a data URL approach
      // Actually just provide the pre-computed hex — it's deterministic
      // "Zero Organization" = 18 chars, "ZORG" = 4 chars, supply = 1B*10^18, owner = DEV_WALLET_ADDRESS
      // We fetch it from the server action result instead
      submitContractVerification("0x0000000000000000000000000000000000000000").then(() => {
        // fallback — just copy source and tell them
      });
    } catch { /* ignore */ }

    // Best approach: encode inline using only built-ins
    const name = "Zero Organization";
    const symbol = "ZORG";
    const supply = BigInt("1000000000") * (BigInt(10) ** BigInt(18));
    const owner = DEV_WALLET_ADDRESS.toLowerCase().replace("0x", "");

    function padHex(hex: string, bytes: number) {
      return hex.padStart(bytes * 2, "0");
    }
    function encodeString(s: string) {
      const bytes = new TextEncoder().encode(s);
      const lenHex = padHex(bytes.length.toString(16), 32);
      let dataHex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
      // pad to multiple of 32 bytes
      if (dataHex.length % 64 !== 0) dataHex = dataHex.padEnd(Math.ceil(dataHex.length / 64) * 64, "0");
      return lenHex + dataHex;
    }

    // 4 params: string, string, uint256, address
    // offsets: each dynamic type points to its data; uint256 and address are static
    // layout: offset(name) | offset(symbol) | supply | owner | name_data | symbol_data
    const nameEncoded = encodeString(name);
    const symbolEncoded = encodeString(symbol);
    const offset1 = 128; // 4 * 32
    const offset2 = offset1 + nameEncoded.length / 2;

    const args = [
      padHex(offset1.toString(16), 32),
      padHex(offset2.toString(16), 32),
      padHex(supply.toString(16), 32),
      padHex(owner, 32),
      nameEncoded,
      symbolEncoded,
    ].join("");

    navigator.clipboard.writeText(args).then(() => {
      setCopiedArgs(true);
      setTimeout(() => setCopiedArgs(false), 2500);
    });
  }

  const isDone = step === "done";
  const isError = step === "error";
  const isWorking = step === "submitting" || step === "polling";

  return (
    <div className="rounded-xl border border-blue-400/20 bg-[#0a0a0a] p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`font-mono text-[9px] font-black px-1.5 py-0.5 rounded ${isDone ? "bg-[#00ff41]/20 text-[#00ff41]" : "bg-blue-400/10 text-blue-400"}`}>
            {isDone ? "✓" : "~"}
          </span>
          <p className="font-mono text-xs font-bold text-white">Verify Contract on Basescan</p>
        </div>
        {isDone && (
          <span className="font-mono text-[9px] text-[#00ff41] bg-[#00ff41]/10 border border-[#00ff41]/20 px-2 py-0.5 rounded">VERIFIED</span>
        )}
      </div>

      {/* Compiler info */}
      <div className="bg-black/30 rounded p-3 space-y-1.5">
        {[
          { label: "Compiler", value: "Solidity 0.8.20" },
          { label: "Optimizer", value: "Enabled · 200 runs" },
          { label: "EVM", value: "london" },
          { label: "License", value: "MIT" },
        ].map(({ label, value }) => (
          <div key={label} className="flex justify-between">
            <span className="font-mono text-[9px] text-white/30 uppercase tracking-widest">{label}</span>
            <span className="font-mono text-[9px] text-white/60">{value}</span>
          </div>
        ))}
      </div>

      {/* Status message */}
      {message && (
        <p className={`font-mono text-[9px] px-3 py-2 rounded leading-relaxed ${
          isDone ? "text-[#00ff41]/80 bg-[#00ff41]/5 border border-[#00ff41]/20" :
          isError ? "text-red-400/80 bg-red-400/5" :
          "text-blue-400/80 bg-blue-400/5"
        }`}>
          {isWorking && <span className="inline-block mr-1 animate-pulse">●</span>}
          {message}
        </p>
      )}

      {/* Auto-verify button */}
      {!isDone && (
        <button
          onClick={isError ? handleRetry : handleVerify}
          disabled={isWorking}
          className="w-full py-3 rounded-lg font-mono text-xs font-bold tracking-widest uppercase transition-all min-h-[44px] active:scale-95 disabled:cursor-not-allowed"
          style={{
            background: isWorking ? "#3b82f622" : isError ? "#ef444422" : "#3b82f6",
            color: isWorking ? "#3b82f6" : isError ? "#ef4444" : "#fff",
            border: isWorking ? "1px solid #3b82f644" : isError ? "1px solid #ef444444" : "none",
          }}
        >
          {isWorking
            ? step === "submitting" ? "Submitting..." : "Verifying on Basescan..."
            : isError ? "Retry Auto-Verify"
            : "Verify Contract Automatically"}
        </button>
      )}

      {/* Manual verification helpers */}
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
        className="flex items-center justify-center gap-2 w-full py-2 rounded-lg font-mono text-[9px] tracking-widest uppercase border border-blue-400/20 text-blue-400/60 hover:text-blue-300 hover:border-blue-400/40 transition-all"
      >
        Open on Basescan →
      </a>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function StepCard({
  step, title, subtitle, state, children, locked, lockedReason,
}: {
  step: number;
  title: string;
  subtitle: string;
  state: StepState;
  children: React.ReactNode;
  locked?: boolean;
  lockedReason?: string;
}) {
  const isDone = state.status === "done";
  const borderColor = isDone ? "border-[#00ff41]/30" : locked ? "border-white/5" : "border-[#00ff41]/15";

  return (
    <div className={`rounded-xl border ${borderColor} bg-[#0a0a0a] p-4 space-y-3 transition-all`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className={`font-mono text-[9px] font-black px-1.5 py-0.5 rounded ${isDone ? "bg-[#00ff41]/20 text-[#00ff41]" : locked ? "bg-white/5 text-white/20" : "bg-[#00ff41]/10 text-[#00ff41]/60"}`}>
              {isDone ? "✓" : `0${step}`}
            </span>
            <p className={`font-mono text-xs font-bold ${locked ? "text-white/20" : "text-white"}`}>{title}</p>
          </div>
          <p className="font-mono text-[9px] text-white/30 mt-0.5 ml-6">{subtitle}</p>
        </div>
        {isDone && <span className="font-mono text-[9px] text-[#00ff41] bg-[#00ff41]/10 border border-[#00ff41]/20 px-2 py-0.5 rounded">DONE</span>}
      </div>

      {locked ? (
        <p className="font-mono text-[10px] text-white/20 text-center py-2">{lockedReason}</p>
      ) : (
        children
      )}

      {state.error && (
        <p className="font-mono text-[9px] text-red-400/80 bg-red-400/5 px-3 py-2 rounded break-all">{state.error}</p>
      )}
    </div>
  );
}

function ActionButton({
  onClick, state, label, pendingLabel, confirmingLabel, disabled, glow, color = "#00ff41",
}: {
  onClick: () => void;
  state: StepState;
  label: string;
  pendingLabel: string;
  confirmingLabel: string;
  disabled?: boolean;
  glow?: boolean;
  color?: string;
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
        color: isProcessing ? color : "#000",
        border: isProcessing ? `1px solid ${color}44` : "none",
        opacity: disabled && !isProcessing ? 0.4 : 1,
        boxShadow: glow && !isProcessing && !disabled ? `0 0 12px ${color}55` : "none",
      }}
    >
      {isPending ? pendingLabel : isConfirming ? confirmingLabel : label}
    </button>
  );
}

function extractLpTokenId(logs: readonly { topics: readonly string[]; address: string }[]): bigint | null {
  // Uniswap V3 NonfungiblePositionManager emits Transfer(from=0, to=recipient, tokenId)
  // topic[0] = keccak256("Transfer(address,address,uint256)")
  const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  for (const log of logs) {
    if (
      log.address.toLowerCase() === UNISWAP_V3_POSITION_MANAGER.toLowerCase() &&
      log.topics[0] === TRANSFER_TOPIC &&
      log.topics.length === 4
    ) {
      return BigInt(log.topics[3]);
    }
  }
  return null;
}
