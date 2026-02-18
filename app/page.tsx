"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TouchEvent } from "react";
import sdk from "@farcaster/miniapp-sdk";
import { Address, Hex, stringToHex } from "viem";

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<any>;
};

type Enemy = { id: number; x: number; y: number; r: number; speed: number; hp: number };
type Bullet = { id: number; x: number; y: number; vx: number; vy: number; life: number };
type BuffType = "haste" | "rapid" | "shield";
type BuffPickup = { id: number; x: number; y: number; type: BuffType; life: number };
type Phase = "menu" | "playing" | "gameover";

const CHAIN_ID_HEX = "0x2105";
const PAYMASTER_URL = process.env.NEXT_PUBLIC_PAYMASTER_PROXY_URL ?? "/api/paymaster";

const WIDTH = 320;
const HEIGHT = 440;
const PLAYER_RADIUS = 10;
const ENEMY_RADIUS = 11;
const BULLET_RADIUS = 3;
const BUFF_RADIUS = 8;

function toAbsoluteUrl(url: string) {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (typeof window === "undefined") return url;
  return new URL(url, window.location.origin).toString();
}

function buildCheckinData(score: number): Hex {
  return stringToHex(JSON.stringify({ app: "pragma", kind: "checkin", score, ts: Date.now() }));
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

function randomBuffType(): BuffType {
  const v = Math.floor(Math.random() * 3);
  if (v === 0) return "haste";
  if (v === 1) return "rapid";
  return "shield";
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
  const [status, setStatus] = useState("Tap Start and drag on arena to move.");
  const [submitting, setSubmitting] = useState(false);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);

  const [timeMs, setTimeMs] = useState(0);
  const [kills, setKills] = useState(0);
  const [wave, setWave] = useState(1);
  const [bestRun, setBestRun] = useState(0);
  const [lastRunScore, setLastRunScore] = useState(0);

  const [player, setPlayer] = useState({ x: WIDTH / 2, y: HEIGHT / 2 });
  const [enemiesView, setEnemiesView] = useState<Enemy[]>([]);
  const [bulletsView, setBulletsView] = useState<Bullet[]>([]);
  const [buffsView, setBuffsView] = useState<BuffPickup[]>([]);
  const [hasteLeftMs, setHasteLeftMs] = useState(0);
  const [rapidLeftMs, setRapidLeftMs] = useState(0);
  const [shieldCharges, setShieldCharges] = useState(0);

  const provider = useMemo(() => {
    if (typeof window === "undefined") return null;
    return (window as Window & { ethereum?: EthereumProvider }).ethereum ?? null;
  }, []);

  const runningRef = useRef(false);
  const arenaRef = useRef<HTMLDivElement | null>(null);
  const touchRef = useRef({ x: 0, y: 0, active: false });
  const keyRef = useRef({ x: 0, y: 0 });
  const playerRef = useRef({ x: WIDTH / 2, y: HEIGHT / 2 });
  const enemiesRef = useRef<Enemy[]>([]);
  const bulletsRef = useRef<Bullet[]>([]);
  const buffsRef = useRef<BuffPickup[]>([]);
  const killRef = useRef(0);
  const timeRef = useRef(0);
  const idRef = useRef(1);
  const shootCdRef = useRef(0.25);
  const spawnCdRef = useRef(1.2);
  const buffSpawnCdRef = useRef(9);
  const graceRef = useRef(1.2);
  const hasteRef = useRef(0);
  const rapidRef = useRef(0);
  const shieldRef = useRef(0);

  const liveScore = Math.floor(timeMs / 1000) + kills * 6 + (wave - 1) * 10;

  const syncBuffView = useCallback(() => {
    setHasteLeftMs(Math.max(0, Math.floor(hasteRef.current * 1000)));
    setRapidLeftMs(Math.max(0, Math.floor(rapidRef.current * 1000)));
    setShieldCharges(shieldRef.current);
  }, []);

  const resetGame = useCallback(() => {
    runningRef.current = false;
    touchRef.current = { x: 0, y: 0, active: false };
    playerRef.current = { x: WIDTH / 2, y: HEIGHT / 2 };
    enemiesRef.current = [];
    bulletsRef.current = [];
    buffsRef.current = [];
    killRef.current = 0;
    timeRef.current = 0;
    shootCdRef.current = 0.25;
    spawnCdRef.current = 1.2;
    buffSpawnCdRef.current = 8.5;
    graceRef.current = 1.2;
    hasteRef.current = 0;
    rapidRef.current = 0;
    shieldRef.current = 0;
    setPlayer(playerRef.current);
    setEnemiesView([]);
    setBulletsView([]);
    setBuffsView([]);
    setKills(0);
    setTimeMs(0);
    setWave(1);
    syncBuffView();
  }, [syncBuffView]);

  const endRun = useCallback((reason: "dead" | "manual") => {
    runningRef.current = false;
    const finalTime = Math.floor(timeRef.current);
    const finalKills = killRef.current;
    const finalWave = Math.floor(finalTime / 15000) + 1;
    const finalScore = Math.floor(finalTime / 1000) + finalKills * 6 + (finalWave - 1) * 10;
    setTimeMs(finalTime);
    setKills(finalKills);
    setWave(finalWave);
    setLastRunScore(finalScore);
    setBestRun((v) => Math.max(v, finalScore));
    setPhase("gameover");
    setStatus(reason === "dead" ? "Run failed: swarm caught you." : "Run ended.");
  }, []);

  const startGame = useCallback(() => {
    resetGame();
    runningRef.current = true;
    setPhase("playing");
    setStatus("Run started.");
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
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.04);
      last = now;

      if (runningRef.current) {
        timeRef.current += dt * 1000;
        const currentWave = Math.floor(timeRef.current / 15000) + 1;
        setWave(currentWave);
        setTimeMs(Math.floor(timeRef.current));

        hasteRef.current = Math.max(0, hasteRef.current - dt);
        rapidRef.current = Math.max(0, rapidRef.current - dt);
        syncBuffView();

        const touch = touchRef.current;
        const moveX = touch.active ? touch.x : keyRef.current.x;
        const moveY = touch.active ? touch.y : keyRef.current.y;
        const moveLen = Math.hypot(moveX, moveY) || 1;
        const nx = moveX / moveLen;
        const ny = moveY / moveLen;
        const speedBoost = hasteRef.current > 0 ? 1.45 : 1;
        const speed = 170 * speedBoost;
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
          const baseInterval = Math.max(0.2, 1 - (currentWave - 1) * 0.08);
          spawnCdRef.current = baseInterval;
          const spawns = 1 + Math.floor((currentWave - 1) / 3);
          for (let i = 0; i < spawns; i += 1) {
            const p = randomSpawnPoint();
            const elite = currentWave >= 4 && Math.random() < Math.min(0.45, 0.08 * currentWave);
            enemiesRef.current.push({
              id: idRef.current++,
              x: p.x,
              y: p.y,
              r: elite ? ENEMY_RADIUS + 3 : ENEMY_RADIUS,
              speed: 28 + currentWave * 4 + Math.random() * 20,
              hp: elite ? 2 : 1
            });
          }
        }

        buffSpawnCdRef.current -= dt;
        if (buffSpawnCdRef.current <= 0) {
          buffSpawnCdRef.current = 10 + Math.random() * 4;
          buffsRef.current.push({
            id: idRef.current++,
            x: 36 + Math.random() * (WIDTH - 72),
            y: 36 + Math.random() * (HEIGHT - 72),
            type: randomBuffType(),
            life: 10
          });
        }

        shootCdRef.current -= dt;
        if (shootCdRef.current <= 0) {
          shootCdRef.current = rapidRef.current > 0 ? 0.16 : 0.28;
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
              vx: (tx / l) * 320,
              vy: (ty / l) * 320,
              life: 1.1
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
        for (const buff of buffsRef.current) {
          buff.life -= dt;
        }

        bulletsRef.current = bulletsRef.current.filter(
          (b) => b.life > 0 && b.x > -24 && b.x < WIDTH + 24 && b.y > -24 && b.y < HEIGHT + 24
        );
        buffsRef.current = buffsRef.current.filter((b) => b.life > 0);

        const removeEnemy = new Set<number>();
        const removeBullet = new Set<number>();
        for (const b of bulletsRef.current) {
          for (const e of enemiesRef.current) {
            if (removeEnemy.has(e.id)) continue;
            if (dist(b.x, b.y, e.x, e.y) < BULLET_RADIUS + e.r) {
              e.hp -= 1;
              removeBullet.add(b.id);
              if (e.hp <= 0) {
                removeEnemy.add(e.id);
                killRef.current += 1;
              }
            }
          }
        }
        if (removeEnemy.size > 0 || removeBullet.size > 0) {
          enemiesRef.current = enemiesRef.current.filter((e) => !removeEnemy.has(e.id));
          bulletsRef.current = bulletsRef.current.filter((b) => !removeBullet.has(b.id));
          setKills(killRef.current);
        }

        for (const buff of buffsRef.current) {
          if (dist(buff.x, buff.y, playerRef.current.x, playerRef.current.y) < BUFF_RADIUS + PLAYER_RADIUS) {
            if (buff.type === "haste") hasteRef.current = 8;
            if (buff.type === "rapid") rapidRef.current = 8;
            if (buff.type === "shield") shieldRef.current += 1;
            buffsRef.current = buffsRef.current.filter((v) => v.id !== buff.id);
            syncBuffView();
          }
        }

        graceRef.current -= dt;
        if (graceRef.current <= 0) {
          let hitEnemy: Enemy | null = null;
          for (const e of enemiesRef.current) {
            if (dist(e.x, e.y, playerRef.current.x, playerRef.current.y) < e.r + PLAYER_RADIUS) {
              hitEnemy = e;
              break;
            }
          }
          if (hitEnemy) {
            if (shieldRef.current > 0) {
              shieldRef.current -= 1;
              graceRef.current = 0.5;
              enemiesRef.current = enemiesRef.current.filter((e) => e.id !== hitEnemy.id);
              syncBuffView();
            } else {
              endRun("dead");
            }
          }
        }

        setPlayer({ ...playerRef.current });
        setEnemiesView([...enemiesRef.current]);
        setBulletsView([...bulletsRef.current]);
        setBuffsView([...buffsRef.current]);
      }
      requestAnimationFrame(loop);
    };
    const id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [endRun, syncBuffView]);

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

  const updateTouchMove = useCallback((clientX: number, clientY: number) => {
    const arena = arenaRef.current;
    if (!arena) return;
    const rect = arena.getBoundingClientRect();
    const px = playerRef.current.x;
    const py = playerRef.current.y;
    const tx = clientX - rect.left;
    const ty = clientY - rect.top;
    const dx = tx - px;
    const dy = ty - py;
    const len = Math.hypot(dx, dy);
    if (len < 8) {
      touchRef.current = { x: 0, y: 0, active: true };
      return;
    }
    touchRef.current = {
      x: Math.max(-1, Math.min(1, dx / len)),
      y: Math.max(-1, Math.min(1, dy / len)),
      active: true
    };
  }, []);

  const onArenaTouchStart = useCallback(
    (e: TouchEvent<HTMLDivElement>) => {
      const t = e.touches[0];
      if (!t) return;
      updateTouchMove(t.clientX, t.clientY);
    },
    [updateTouchMove]
  );
  const onArenaTouchMove = useCallback(
    (e: TouchEvent<HTMLDivElement>) => {
      const t = e.touches[0];
      if (!t) return;
      updateTouchMove(t.clientX, t.clientY);
    },
    [updateTouchMove]
  );
  const onArenaTouchEnd = useCallback(() => {
    touchRef.current = { x: 0, y: 0, active: false };
  }, []);

  const activeBuffs = [
    hasteLeftMs > 0 ? `Haste ${Math.ceil(hasteLeftMs / 1000)}s` : null,
    rapidLeftMs > 0 ? `Rapid ${Math.ceil(rapidLeftMs / 1000)}s` : null,
    shieldCharges > 0 ? `Shield x${shieldCharges}` : null
  ].filter(Boolean) as string[];

  return (
    <main className="page">
      <section className="card">
        <header className="top">
          <p className="eyebrow">Base Mini App</p>
          <h1>Pragma</h1>
        </header>

        {phase !== "playing" && (
          <>
            <p className="muted">Drag finger on arena to steer. Survive longer waves and stack buffs.</p>
            <div className="menu-stats">
              <div className="menu-stat"><span>Best</span><strong>{bestRun}</strong></div>
              <div className="menu-stat"><span>Last</span><strong>{lastRunScore}</strong></div>
              <div className="menu-stat"><span>Wallet</span><strong>{account ? "Connected" : "Offline"}</strong></div>
              <div className="menu-stat"><span>Last Tx</span><strong>{lastTxHash ? "Yes" : "No"}</strong></div>
            </div>
            <div className="menu-actions">
              <button className="primary big" onClick={startGame}>Start Run</button>
              <button className="ghost big" onClick={connect} disabled={!!account}>
                {account ? "Wallet Connected" : "Connect Wallet"}
              </button>
              <button className="primary" onClick={submitGasless} disabled={submitting}>
                {submitting ? "Submitting..." : "Submit Last Run"}
              </button>
            </div>
          </>
        )}

        {phase === "playing" && (
          <>
            <div className="hud-live">
              <span>{(timeMs / 1000).toFixed(1)}s</span>
              <span>Wave {wave}</span>
              <span>Kills {kills}</span>
              <span>Score {liveScore}</span>
            </div>
            <div className="buff-row">
              {activeBuffs.length ? activeBuffs.map((b) => <span key={b}>{b}</span>) : <span>No Buff</span>}
            </div>
            <div className="arena">
              <div
                ref={arenaRef}
                className="arena-touch"
                onTouchStart={onArenaTouchStart}
                onTouchMove={onArenaTouchMove}
                onTouchEnd={onArenaTouchEnd}
              />
              <div className="player" style={{ left: player.x - PLAYER_RADIUS, top: player.y - PLAYER_RADIUS }} />
              {enemiesView.map((e) => (
                <div
                  key={e.id}
                  className={`enemy ${e.hp > 1 ? "elite" : ""}`}
                  style={{ left: e.x - e.r, top: e.y - e.r, width: e.r * 2, height: e.r * 2 }}
                />
              ))}
              {bulletsView.map((b) => (
                <div
                  key={b.id}
                  className="bullet"
                  style={{ left: b.x - BULLET_RADIUS, top: b.y - BULLET_RADIUS, width: BULLET_RADIUS * 2, height: BULLET_RADIUS * 2 }}
                />
              ))}
              {buffsView.map((b) => (
                <div
                  key={b.id}
                  className={`buff ${b.type}`}
                  style={{ left: b.x - BUFF_RADIUS, top: b.y - BUFF_RADIUS, width: BUFF_RADIUS * 2, height: BUFF_RADIUS * 2 }}
                />
              ))}
            </div>
            <div className="actions">
              <button className="ghost" onClick={() => endRun("manual")}>End Run</button>
            </div>
          </>
        )}

        {phase !== "playing" && (
          <div className="meta">
            <p>Status: {status}</p>
            <p>Last tx: {lastTxHash ?? "-"}</p>
            <p>Paymaster URL: {toAbsoluteUrl(PAYMASTER_URL)}</p>
          </div>
        )}
      </section>
    </main>
  );
}

