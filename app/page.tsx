"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import sdk from "@farcaster/miniapp-sdk";
import { Address, createPublicClient, encodeFunctionData, http } from "viem";
import { baseSepolia } from "viem/chains";
import { gameAbi } from "@/lib/gameAbi";

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<any>;
};

const CHAIN_ID_HEX = `0x${baseSepolia.id.toString(16)}`;
const RPC_URL =
  process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
const PAYMASTER_URL = process.env.NEXT_PUBLIC_PAYMASTER_PROXY_URL ?? "/api/paymaster";
const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_GAME_CONTRACT_ADDRESS as
  | Address
  | undefined;

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL)
});

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function HomePage() {
  const [score, setScore] = useState(0);
  const [account, setAccount] = useState<Address | null>(null);
  const [bestOnchain, setBestOnchain] = useState<bigint | null>(null);
  const [status, setStatus] = useState("Tap to increase your score.");
  const [submitting, setSubmitting] = useState(false);

  const provider = useMemo(() => {
    if (typeof window === "undefined") return null;
    return (window as Window & { ethereum?: EthereumProvider }).ethereum ?? null;
  }, []);

  const refreshBestScore = useCallback(async () => {
    if (!account || !CONTRACT_ADDRESS) return;
    const best = await publicClient.readContract({
      address: CONTRACT_ADDRESS,
      abi: gameAbi,
      functionName: "bestScore",
      args: [account]
    });
    setBestOnchain(best);
  }, [account]);

  const connect = useCallback(async () => {
    if (!provider) {
      setStatus("No wallet provider found. Open this inside Base App.");
      return;
    }

    const accounts = (await provider.request({
      method: "eth_requestAccounts"
    })) as Address[];

    if (!accounts.length) {
      setStatus("Wallet is connected, but no account was returned.");
      return;
    }

    setAccount(accounts[0]);
    setStatus("Wallet connected.");
  }, [provider]);

  const submitGasless = useCallback(async () => {
    if (!provider || !account) {
      setStatus("Connect wallet first.");
      return;
    }

    if (!CONTRACT_ADDRESS) {
      setStatus("Set NEXT_PUBLIC_GAME_CONTRACT_ADDRESS in .env.local");
      return;
    }

    if (score <= 0) {
      setStatus("Increase your score before submitting.");
      return;
    }

    setSubmitting(true);
    try {
      const capabilitiesResponse = await provider.request({
        method: "wallet_getCapabilities",
        params: [account]
      });
      const chainCaps =
        capabilitiesResponse?.[account]?.[CHAIN_ID_HEX] ??
        capabilitiesResponse?.[CHAIN_ID_HEX];

      if (!chainCaps?.paymasterService?.supported) {
        throw new Error("Paymaster is not supported by this wallet on Base Sepolia.");
      }

      const data = encodeFunctionData({
        abi: gameAbi,
        functionName: "submitScore",
        args: [BigInt(score)]
      });

      const calls = [
        {
          to: CONTRACT_ADDRESS,
          data,
          value: "0x0"
        }
      ];

      let sendResult: any;
      try {
        sendResult = await provider.request({
          method: "wallet_sendCalls",
          params: [
            {
              version: "2.0.0",
              chainId: CHAIN_ID_HEX,
              from: account,
              calls,
              capabilities: {
                paymasterService: { url: PAYMASTER_URL }
              }
            }
          ]
        });
      } catch {
        sendResult = await provider.request({
          method: "wallet_sendCalls",
          params: [
            {
              version: "1.0",
              chainId: CHAIN_ID_HEX,
              from: account,
              calls,
              capabilities: {
                paymasterService: { url: PAYMASTER_URL }
              }
            }
          ]
        });
      }

      const callId = sendResult?.id;
      if (!callId) {
        setStatus("Transaction requested. Waiting in wallet.");
      } else {
        setStatus(`Submitted (call id: ${callId}). Refreshing score...`);
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));
      await refreshBestScore();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown submit error";
      setStatus(`Submit failed: ${message}`);
    } finally {
      setSubmitting(false);
    }
  }, [account, provider, refreshBestScore, score]);

  useEffect(() => {
    sdk.actions
      .ready()
      .then(() => {
        setStatus("Mini app ready.");
      })
      .catch(() => {
        setStatus("Running outside Base App is allowed, but some features may fail.");
      });
  }, []);

  useEffect(() => {
    if (!account || !CONTRACT_ADDRESS) return;
    refreshBestScore().catch(() => {
      setStatus("Connected, but failed to read best score from contract.");
    });
  }, [account, refreshBestScore]);

  return (
    <main className="page">
      <section className="card">
        <p className="eyebrow">Base Mini App</p>
        <h1>Tap Score</h1>
        <p className="muted">
          Build score locally, then send it onchain with a sponsored transaction.
        </p>

        <div className="score">{score}</div>

        <div className="actions">
          <button className="primary" onClick={() => setScore((s) => s + 1)}>
            Tap +1
          </button>
          <button className="ghost" onClick={() => setScore(0)}>
            Reset
          </button>
        </div>

        <div className="actions">
          <button className="primary" onClick={connect} disabled={!!account}>
            {account ? `Connected ${shortAddress(account)}` : "Connect wallet"}
          </button>
          <button className="primary" onClick={submitGasless} disabled={submitting}>
            {submitting ? "Submitting..." : "Submit gasless"}
          </button>
        </div>

        <div className="meta">
          <p>Status: {status}</p>
          <p>Contract: {CONTRACT_ADDRESS ?? "not configured"}</p>
          <p>Best onchain: {bestOnchain !== null ? bestOnchain.toString() : "-"}</p>
        </div>
      </section>
    </main>
  );
}

