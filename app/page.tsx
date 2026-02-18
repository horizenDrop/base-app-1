"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import sdk from "@farcaster/miniapp-sdk";
import { Address, Hex, stringToHex } from "viem";

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<any>;
};

type Enemy = { id: number; x: number; y: number; r: number; speed: number };
type Bullet = { id: number; x: number; y: number; vx: number; vy: number; life: number };

const CHAIN_ID_HEX = "0x2105";
const PAYMASTER_URL = process.env.NEXT_PUBLIC_PAYMASTER_PROXY_URL ?? "/api/paymaster";

const WIDTH = 320;
const HEIGHT = 440;
const PLAYER_RADIUS = 10;
const ENEMY_RADIUS = 11;
const BULLET_RADIUS = 3;

function toAbsoluteUrl(url: string) {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (typeof window === "undefined") return url;
  return new URL(url, window.location.origin).toString();
}

function buildCheckinData(score: number): Hex {
  const payload = JSON.stringify({
    app: "pragma",
    kind: "checkin",
    score,
    ts: Date.now()
  });
  return stringToHex(payload);
}

function dist(aX: number, aY: number, bX: number, bY: number) {
  const dx = aX - bX;
  const dy = aY - bY;
  return Math.hypot(dx, dy);
}

function randomSpawnPoint() {
  const side = Math.floor(Math.random() * 4);
  if (side === 0) return { x: Math.random() * WIDTH, y: -16 };
  if (side === 1) return { x: WIDTH + 16, y: Math.random() * HEIGHT };
  if (side === 2) return { x: Math.random() * WIDTH, y: HEIGHT + 16 };
  return { x: -16, y: Math.random() * HEIGHT };
}

async function pollBatchStatus(provider: EthereumProvider, batchId: string) {
  for (let i = 0; i < 15; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const statusResult = await provider.request({
      method: "wallet_getCallsStatus",
      params: [batchId]
    });
    const code = statusResult?.status;
    if (code === 100) continue;
    if (code === 200) return statusResult;
    throw new Error(`Batch failed with status ${String(code)}`);
  }
  throw new Error("Batch status timeout");
}

function extractTxHash(statusResult: any): string | null {
  if (!statusResult) return null;
  const a = statusResult?.receipts?.[0]?.transactionHash;
  if (typeof a === "string") return a;
  const b = statusResult?.transactions?.[0]?.hash;
  if (typeof b === "string") return b;
  return null;
}

export default function HomePage() {
  const [account, setAccount] = useState<Address | null>(null);
  const [status, setStatus] = useState("Press Start and survive.");
  const [submitting, setSubmitting] = useState(false);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [kills, setKills] = useState(0);
  const [timeMs, setTimeMs] = useState(0);
  const [bestRun, setBestRun] = useState(0);
  const [player, setPlayer] = useState({ x: WIDTH / 2, y: HEIGHT / 2 });
  const [enemiesView, setEnemiesView] = useState<Enemy[]>([]);
  const [bulletsView, setBulletsView] = useState<Bullet[]>([]);

  const provider = useMemo(() => {
    if (typeof window === "undefined") return null;
    return (window as Window & { ethereum?: EthereumProvider }).ethereum ?? null;
  }, []);

  const keysRef = useRef<Record<string, boolean>>({});
  const runningRef = useRef(false);
  const playerRef = useRef({ x: WIDTH / 2, y: HEIGHT / 2 });
  const enemiesRef = useRef<Enemy[]>([]);
  const bulletsRef = useRef<Bullet[]>([]);
  const killRef = useRef(0);
  const timeRef = useRef(0);
  const idRef = useRef(1);
  const shootCdRef = useRef(0);
  const spawnCdRef = useRef(0);

  const score = Math.floor(timeMs / 1000) + kills * 5;

  const resetGame = useCallback(() => {
    playerRef.current = { x: WIDTH / 2, y: HEIGHT / 2 };
    enemiesRef.current = [];
    bulletsRef.current = [];
    killRef.current = 0;
    timeRef.current = 0;
    shootCdRef.current = 0;
    spawnCdRef.current = 0;
    setPlayer(playerRef.current);
    setEnemiesView([]);
    setBulletsView([]);
    setKills(0);
    setTimeMs(0);
  }, []);

  const startGame = useCallback(() => {
    resetGame();
    setRunning(true);
    runningRef.current = true;
  }, [resetGame]);

  const stopGame = useCallback(() => {
    runningRef.current = false;
    setRunning(false);
    setBestRun((prev) => Math.max(prev, score));
    setStatus(`Run ended. Score ${score}.`);
  }, [score]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      keysRef.current[e.key.toLowerCase()] = true;
    };
    const up = (e: KeyboardEvent) => {
      keysRef.current[e.key.toLowerCase()] = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useEffect(() => {
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.04);
      last = now;
      if (runningRef.current) {
        timeRef.current += dt * 1000;
        setTimeMs(Math.floor(timeRef.current));

        const keys = keysRef.current;
        const left = keys.a || keys.arrowleft;
        const right = keys.d || keys.arrowright;
        const up = keys.w || keys.arrowup;
        const down = keys.s || keys.arrowdown;
        let dx = 0;
        let dy = 0;
        if (left) dx -= 1;
        if (right) dx += 1;
        if (up) dy -= 1;
        if (down) dy += 1;
        if (dx !== 0 || dy !== 0) {
          const len = Math.hypot(dx, dy);
          dx /= len;
          dy /= len;
          const speed = 165;
          playerRef.current.x = Math.max(
            PLAYER_RADIUS,
            Math.min(WIDTH - PLAYER_RADIUS, playerRef.current.x + dx * speed * dt)
          );
          playerRef.current.y = Math.max(
            PLAYER_RADIUS,
            Math.min(HEIGHT - PLAYER_RADIUS, playerRef.current.y + dy * speed * dt)
          );
        }

        spawnCdRef.current -= dt;
        if (spawnCdRef.current <= 0) {
          spawnCdRef.current = Math.max(0.28, 0.9 - timeRef.current / 20000);
          const p = randomSpawnPoint();
          enemiesRef.current.push({
            id: idRef.current++,
            x: p.x,
            y: p.y,
            r: ENEMY_RADIUS,
            speed: 40 + Math.random() * 35 + Math.min(90, timeRef.current / 600)
          });
        }

        shootCdRef.current -= dt;
        if (shootCdRef.current <= 0) {
          shootCdRef.current = 0.33;
          const nearest = enemiesRef.current
            .map((e) => ({ e, d: dist(e.x, e.y, playerRef.current.x, playerRef.current.y) }))
            .sort((a, b) => a.d - b.d)[0];
          if (nearest) {
            const tx = nearest.e.x - playerRef.current.x;
            const ty = nearest.e.y - playerRef.current.y;
            const l = Math.hypot(tx, ty) || 1;
            const speed = 280;
            bulletsRef.current.push({
              id: idRef.current++,
              x: playerRef.current.x,
              y: playerRef.current.y,
              vx: (tx / l) * speed,
              vy: (ty / l) * speed,
              life: 1.2
            });
          }
        }

        for (const e of enemiesRef.current) {
          const tx = playerRef.current.x - e.x;
          const ty = playerRef.current.y - e.y;
          const l = Math.hypot(tx, ty) || 1;
          e.x += (tx / l) * e.speed * dt;
          e.y += (ty / l) * e.speed * dt;
        }

        for (const b of bulletsRef.current) {
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          b.life -= dt;
        }
        bulletsRef.current = bulletsRef.current.filter(
          (b) => b.life > 0 && b.x > -20 && b.x < WIDTH + 20 && b.y > -20 && b.y < HEIGHT + 20
        );

        const removedEnemies = new Set<number>();
        const removedBullets = new Set<number>();
        for (const b of bulletsRef.current) {
          for (const e of enemiesRef.current) {
            if (removedEnemies.has(e.id)) continue;
            if (dist(b.x, b.y, e.x, e.y) < BULLET_RADIUS + e.r) {
              removedEnemies.add(e.id);
              removedBullets.add(b.id);
              killRef.current += 1;
            }
          }
        }
        if (removedEnemies.size > 0) {
          enemiesRef.current = enemiesRef.current.filter((e) => !removedEnemies.has(e.id));
          bulletsRef.current = bulletsRef.current.filter((b) => !removedBullets.has(b.id));
          setKills(killRef.current);
        }

        const hit = enemiesRef.current.some(
          (e) => dist(e.x, e.y, playerRef.current.x, playerRef.current.y) < e.r + PLAYER_RADIUS
        );
        if (hit) {
          stopGame();
        }

        setPlayer({ ...playerRef.current });
        setEnemiesView([...enemiesRef.current]);
        setBulletsView([...bulletsRef.current]);
      }
      requestAnimationFrame(loop);
    };
    const id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [stopGame]);

  const connect = useCallback(async () => {
    if (!provider) {
      setStatus("No wallet provider found. Open inside Base App.");
      return;
    }
    const accounts = (await provider.request({
      method: "eth_requestAccounts"
    })) as Address[];
    if (!accounts.length) {
      setStatus("Wallet connected, but no account returned.");
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
    if (score <= 0) {
      setStatus("Play one run before submit.");
      return;
    }

    setSubmitting(true);
    try {
      const capabilitiesResponse = await provider.request({
        method: "wallet_getCapabilities",
        params: [account]
      });
      const caps = capabilitiesResponse?.[account] ?? capabilitiesResponse;
      const chainCaps =
        caps?.[CHAIN_ID_HEX] ?? caps?.["8453"] ?? caps?.["eip155:8453"] ?? null;
      if (!chainCaps?.paymasterService?.supported) {
        throw new Error("Paymaster is not enabled in this wallet.");
      }

      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CHAIN_ID_HEX }]
      });

      const sendResult = await provider.request({
        method: "wallet_sendCalls",
        params: [
          {
            version: "2.0.0",
            chainId: CHAIN_ID_HEX,
            from: account,
            atomicRequired: false,
            calls: [{ to: account, data: buildCheckinData(score), value: "0x0" }],
            capabilities: { paymasterService: { url: toAbsoluteUrl(PAYMASTER_URL) } }
          }
        ]
      });

      const batchId =
        typeof sendResult === "string"
          ? sendResult
          : (sendResult?.batchId ?? sendResult?.id ?? null);

      if (batchId) {
        setStatus(`Submitted. Batch ${batchId}...`);
        const statusResult = await pollBatchStatus(provider, batchId);
        const txHash = extractTxHash(statusResult);
        if (txHash) setLastTxHash(txHash);
      }

      setStatus("Check-in saved onchain.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setStatus(`Submit failed: ${message}`);
    } finally {
      setSubmitting(false);
    }
  }, [account, provider, score]);

  useEffect(() => {
    sdk.actions.ready().catch(() => null);
  }, []);

  const setMove = useCallback((key: string, value: boolean) => {
    keysRef.current[key] = value;
  }, []);

  return (
    <main className="page">
      <section className="card">
        <p className="eyebrow">Base Mini App</p>
        <h1>Pragma</h1>
        <p className="muted">Minimal survival: move, auto-fire, last as long as possible.</p>

        <div className="hud">
          <span>Time: {(timeMs / 1000).toFixed(1)}s</span>
          <span>Kills: {kills}</span>
          <span>Score: {score}</span>
          <span>Best: {bestRun}</span>
        </div>

        <div className="arena">
          <div
            className="player"
            style={{ left: player.x - PLAYER_RADIUS, top: player.y - PLAYER_RADIUS }}
          />
          {enemiesView.map((e) => (
            <div
              key={e.id}
              className="enemy"
              style={{ left: e.x - e.r, top: e.y - e.r, width: e.r * 2, height: e.r * 2 }}
            />
          ))}
          {bulletsView.map((b) => (
            <div
              key={b.id}
              className="bullet"
              style={{
                left: b.x - BULLET_RADIUS,
                top: b.y - BULLET_RADIUS,
                width: BULLET_RADIUS * 2,
                height: BULLET_RADIUS * 2
              }}
            />
          ))}
        </div>

        <div className="actions">
          <button className="primary" onClick={startGame} disabled={running}>
            Start
          </button>
          <button className="ghost" onClick={stopGame} disabled={!running}>
            End run
          </button>
          <button className="ghost" onClick={resetGame}>
            Reset
          </button>
        </div>

        <div className="pad">
          <button
            className="pad-btn"
            onMouseDown={() => setMove("w", true)}
            onMouseUp={() => setMove("w", false)}
            onMouseLeave={() => setMove("w", false)}
            onTouchStart={() => setMove("w", true)}
            onTouchEnd={() => setMove("w", false)}
          >
            ↑
          </button>
          <button
            className="pad-btn"
            onMouseDown={() => setMove("a", true)}
            onMouseUp={() => setMove("a", false)}
            onMouseLeave={() => setMove("a", false)}
            onTouchStart={() => setMove("a", true)}
            onTouchEnd={() => setMove("a", false)}
          >
            ←
          </button>
          <button
            className="pad-btn"
            onMouseDown={() => setMove("s", true)}
            onMouseUp={() => setMove("s", false)}
            onMouseLeave={() => setMove("s", false)}
            onTouchStart={() => setMove("s", true)}
            onTouchEnd={() => setMove("s", false)}
          >
            ↓
          </button>
          <button
            className="pad-btn"
            onMouseDown={() => setMove("d", true)}
            onMouseUp={() => setMove("d", false)}
            onMouseLeave={() => setMove("d", false)}
            onTouchStart={() => setMove("d", true)}
            onTouchEnd={() => setMove("d", false)}
          >
            →
          </button>
        </div>

        <div className="actions">
          <button className="primary" onClick={connect} disabled={!!account}>
            {account ? `${account.slice(0, 6)}...${account.slice(-4)}` : "Connect wallet"}
          </button>
          <button className="primary" onClick={submitGasless} disabled={submitting}>
            {submitting ? "Submitting..." : "Submit gasless check-in"}
          </button>
        </div>

        <div className="meta">
          <p>Status: {status}</p>
          <p>Chain: Base (0x2105)</p>
          <p>Paymaster URL: {toAbsoluteUrl(PAYMASTER_URL)}</p>
          <p>Last tx: {lastTxHash ?? "-"}</p>
        </div>
      </section>
    </main>
  );
}

