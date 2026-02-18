"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import sdk from "@farcaster/miniapp-sdk";
import { Address, Hex, stringToHex } from "viem";

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<any>;
};

type Enemy = { id: number; x: number; y: number; r: number; speed: number };
type Bullet = { id: number; x: number; y: number; vx: number; vy: number; life: number };
type Phase = "menu" | "playing" | "gameover";

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
  return stringToHex(
    JSON.stringify({
      app: "pragma",
      kind: "checkin",
      score,
      ts: Date.now()
    })
  );
}

function dist(aX: number, aY: number, bX: number, bY: number) {
  const dx = aX - bX;
  const dy = aY - bY;
  return Math.hypot(dx, dy);
}

function randomSpawnPoint() {
  const side = Math.floor(Math.random() * 4);
  if (side === 0) return { x: Math.random() * WIDTH, y: -20 };
  if (side === 1) return { x: WIDTH + 20, y: Math.random() * HEIGHT };
  if (side === 2) return { x: Math.random() * WIDTH, y: HEIGHT + 20 };
  return { x: -20, y: Math.random() * HEIGHT };
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
  const a = statusResult?.receipts?.[0]?.transactionHash;
  if (typeof a === "string") return a;
  const b = statusResult?.transactions?.[0]?.hash;
  if (typeof b === "string") return b;
  return null;
}

export default function HomePage() {
  const [phase, setPhase] = useState<Phase>("menu");
  const [account, setAccount] = useState<Address | null>(null);
  const [status, setStatus] = useState("Enable sensor, then start the run.");
  const [submitting, setSubmitting] = useState(false);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);

  const [timeMs, setTimeMs] = useState(0);
  const [kills, setKills] = useState(0);
  const [bestRun, setBestRun] = useState(0);
  const [lastRunScore, setLastRunScore] = useState(0);

  const [sensorEnabled, setSensorEnabled] = useState(false);
  const [sensorSupported, setSensorSupported] = useState(false);
  const [player, setPlayer] = useState({ x: WIDTH / 2, y: HEIGHT / 2 });
  const [enemiesView, setEnemiesView] = useState<Enemy[]>([]);
  const [bulletsView, setBulletsView] = useState<Bullet[]>([]);

  const provider = useMemo(() => {
    if (typeof window === "undefined") return null;
    return (window as Window & { ethereum?: EthereumProvider }).ethereum ?? null;
  }, []);

  const runningRef = useRef(false);
  const playerRef = useRef({ x: WIDTH / 2, y: HEIGHT / 2 });
  const enemiesRef = useRef<Enemy[]>([]);
  const bulletsRef = useRef<Bullet[]>([]);
  const killRef = useRef(0);
  const timeRef = useRef(0);
  const idRef = useRef(1);
  const shootCdRef = useRef(0);
  const spawnCdRef = useRef(1.4);
  const graceRef = useRef(0);
  const tiltRef = useRef({ x: 0, y: 0 });
  const keyRef = useRef({ x: 0, y: 0 });

  const liveScore = Math.floor(timeMs / 1000) + kills * 5;

  const resetGame = useCallback(() => {
    runningRef.current = false;
    playerRef.current = { x: WIDTH / 2, y: HEIGHT / 2 };
    enemiesRef.current = [];
    bulletsRef.current = [];
    killRef.current = 0;
    timeRef.current = 0;
    shootCdRef.current = 0.2;
    spawnCdRef.current = 1.4;
    graceRef.current = 1.3;
    setPlayer(playerRef.current);
    setEnemiesView([]);
    setBulletsView([]);
    setKills(0);
    setTimeMs(0);
  }, []);

  const endRun = useCallback((reason: "dead" | "manual") => {
    runningRef.current = false;
    const finalTime = Math.floor(timeRef.current);
    const finalKills = killRef.current;
    const finalScore = Math.floor(finalTime / 1000) + finalKills * 5;
    setTimeMs(finalTime);
    setKills(finalKills);
    setLastRunScore(finalScore);
    setBestRun((p) => Math.max(p, finalScore));
    setPhase("gameover");
    setStatus(reason === "dead" ? "You were overrun." : "Run ended.");
  }, []);

  const startGame = useCallback(() => {
    resetGame();
    runningRef.current = true;
    setPhase("playing");
    setStatus("Survive.");
  }, [resetGame]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key.toLowerCase() === "a") keyRef.current.x = -1;
      if (e.key === "ArrowRight" || e.key.toLowerCase() === "d") keyRef.current.x = 1;
      if (e.key === "ArrowUp" || e.key.toLowerCase() === "w") keyRef.current.y = -1;
      if (e.key === "ArrowDown" || e.key.toLowerCase() === "s") keyRef.current.y = 1;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight" ||
        e.key.toLowerCase() === "a" ||
        e.key.toLowerCase() === "d"
      ) {
        keyRef.current.x = 0;
      }
      if (
        e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key.toLowerCase() === "w" ||
        e.key.toLowerCase() === "s"
      ) {
        keyRef.current.y = 0;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setSensorSupported("DeviceOrientationEvent" in window);
  }, []);

  useEffect(() => {
    if (!sensorEnabled) return;
    const onOrientation = (e: DeviceOrientationEvent) => {
      const beta = e.beta ?? 0;
      const gamma = e.gamma ?? 0;
      const x = Math.max(-1, Math.min(1, gamma / 28));
      const y = Math.max(-1, Math.min(1, beta / 28));
      tiltRef.current = { x, y };
    };
    window.addEventListener("deviceorientation", onOrientation);
    return () => window.removeEventListener("deviceorientation", onOrientation);
  }, [sensorEnabled]);

  const enableSensor = useCallback(async () => {
    try {
      const AnyOrientation = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
        requestPermission?: () => Promise<"granted" | "denied">;
      };
      if (typeof AnyOrientation.requestPermission === "function") {
        const permission = await AnyOrientation.requestPermission();
        if (permission !== "granted") {
          setStatus("Sensor permission denied.");
          return;
        }
      }
      setSensorEnabled(true);
      setStatus("Sensor enabled.");
    } catch {
      setStatus("Could not enable sensor.");
    }
  }, []);

  useEffect(() => {
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.04);
      last = now;

      if (runningRef.current) {
        timeRef.current += dt * 1000;
        setTimeMs(Math.floor(timeRef.current));

        const sensor = sensorEnabled ? tiltRef.current : { x: 0, y: 0 };
        const moveX = Math.abs(sensor.x) > 0.05 ? sensor.x : keyRef.current.x;
        const moveY = Math.abs(sensor.y) > 0.05 ? sensor.y : keyRef.current.y;
        const moveLen = Math.hypot(moveX, moveY) || 1;
        const nx = moveX / moveLen;
        const ny = moveY / moveLen;
        const speed = 170;

        playerRef.current.x = Math.max(
          PLAYER_RADIUS,
          Math.min(WIDTH - PLAYER_RADIUS, playerRef.current.x + nx * speed * dt)
        );
        playerRef.current.y = Math.max(
          PLAYER_RADIUS,
          Math.min(HEIGHT - PLAYER_RADIUS, playerRef.current.y + ny * speed * dt)
        );

        spawnCdRef.current -= dt;
        if (spawnCdRef.current <= 0) {
          spawnCdRef.current = Math.max(0.38, 0.95 - timeRef.current / 26000);
          const p = randomSpawnPoint();
          enemiesRef.current.push({
            id: idRef.current++,
            x: p.x,
            y: p.y,
            r: ENEMY_RADIUS,
            speed: 28 + Math.random() * 20 + Math.min(45, timeRef.current / 1300)
          });
        }

        shootCdRef.current -= dt;
        if (shootCdRef.current <= 0) {
          shootCdRef.current = 0.28;
          let nearest: Enemy | null = null;
          let nearestDist = Infinity;
          for (const e of enemiesRef.current) {
            const d = dist(e.x, e.y, playerRef.current.x, playerRef.current.y);
            if (d < nearestDist) {
              nearest = e;
              nearestDist = d;
            }
          }
          if (nearest) {
            const tx = nearest.x - playerRef.current.x;
            const ty = nearest.y - playerRef.current.y;
            const l = Math.hypot(tx, ty) || 1;
            bulletsRef.current.push({
              id: idRef.current++,
              x: playerRef.current.x,
              y: playerRef.current.y,
              vx: (tx / l) * 300,
              vy: (ty / l) * 300,
              life: 1.25
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
          (b) => b.life > 0 && b.x > -24 && b.x < WIDTH + 24 && b.y > -24 && b.y < HEIGHT + 24
        );

        const removeEnemy = new Set<number>();
        const removeBullet = new Set<number>();
        for (const b of bulletsRef.current) {
          for (const e of enemiesRef.current) {
            if (removeEnemy.has(e.id)) continue;
            if (dist(b.x, b.y, e.x, e.y) < BULLET_RADIUS + e.r) {
              removeEnemy.add(e.id);
              removeBullet.add(b.id);
              killRef.current += 1;
            }
          }
        }
        if (removeEnemy.size > 0) {
          enemiesRef.current = enemiesRef.current.filter((e) => !removeEnemy.has(e.id));
          bulletsRef.current = bulletsRef.current.filter((b) => !removeBullet.has(b.id));
          setKills(killRef.current);
        }

        graceRef.current -= dt;
        if (graceRef.current <= 0) {
          const hit = enemiesRef.current.some(
            (e) => dist(e.x, e.y, playerRef.current.x, playerRef.current.y) < e.r + PLAYER_RADIUS
          );
          if (hit) endRun("dead");
        }

        setPlayer({ ...playerRef.current });
        setEnemiesView([...enemiesRef.current]);
        setBulletsView([...bulletsRef.current]);
      }

      requestAnimationFrame(loop);
    };
    const id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [endRun, sensorEnabled]);

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
    if (lastRunScore <= 0) {
      setStatus("Play at least one run.");
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
            calls: [{ to: account, data: buildCheckinData(lastRunScore), value: "0x0" }],
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
  }, [account, lastRunScore, provider]);

  useEffect(() => {
    sdk.actions.ready().catch(() => null);
  }, []);

  return (
    <main className="page">
      <section className="card">
        <p className="eyebrow">Base Mini App</p>
        <h1>Pragma</h1>

        {phase !== "playing" && (
          <>
            <p className="muted">Tilt to move. Survive and auto-shoot incoming swarm.</p>
            <div className="menu-grid">
              <div className="menu-stat">Best: {bestRun}</div>
              <div className="menu-stat">Last: {lastRunScore}</div>
              <div className="menu-stat">Sensor: {sensorEnabled ? "On" : "Off"}</div>
              <div className="menu-stat">
                Wallet: {account ? `${account.slice(0, 6)}...${account.slice(-4)}` : "Not connected"}
              </div>
            </div>
            <div className="actions">
              <button className="primary" onClick={startGame}>
                Start Run
              </button>
              <button
                className="ghost"
                onClick={enableSensor}
                disabled={!sensorSupported || sensorEnabled}
              >
                {sensorEnabled ? "Sensor Enabled" : "Enable Sensor"}
              </button>
            </div>
            <div className="actions">
              <button className="ghost" onClick={connect} disabled={!!account}>
                {account ? "Wallet Connected" : "Connect Wallet"}
              </button>
              <button className="primary" onClick={submitGasless} disabled={submitting}>
                {submitting ? "Submitting..." : "Submit Gasless Check-in"}
              </button>
            </div>
          </>
        )}

        {phase === "playing" && (
          <>
            <div className="hud-live">
              <span>{(timeMs / 1000).toFixed(1)}s</span>
              <span>Kills {kills}</span>
              <span>Score {liveScore}</span>
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
              <button className="ghost" onClick={() => endRun("manual")}>
                End Run
              </button>
            </div>
          </>
        )}

        <div className="meta">
          <p>Status: {status}</p>
          <p>Last tx: {lastTxHash ?? "-"}</p>
        </div>
      </section>
    </main>
  );
}

