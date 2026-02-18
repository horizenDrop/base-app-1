import { NextRequest, NextResponse } from "next/server";

type LeaderboardEntry = {
  address: string;
  bestScore: number;
  verifiedBestScore: number;
  lastScore: number;
  totalRuns: number;
  level: number;
  levelXp: number;
  updatedAt: number;
};

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const KV_KEY = "pragma:leaderboard:v1";

const store = globalThis as unknown as {
  pragmaLeaderboard?: Map<string, LeaderboardEntry>;
};

if (!store.pragmaLeaderboard) {
  store.pragmaLeaderboard = new Map<string, LeaderboardEntry>();
}

async function kvCommand(command: unknown[]) {
  if (!KV_URL || !KV_TOKEN) return null;
  const response = await fetch(KV_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(command),
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`KV command failed with status ${response.status}`);
  }
  const json = (await response.json()) as { result?: unknown };
  return json.result ?? null;
}

async function readEntries() {
  if (KV_URL && KV_TOKEN) {
    const result = await kvCommand(["GET", KV_KEY]);
    if (typeof result === "string" && result.length > 0) {
      const parsed = JSON.parse(result) as LeaderboardEntry[];
      return parsed;
    }
    return [];
  }
  return [...store.pragmaLeaderboard!.values()];
}

async function writeEntries(entries: LeaderboardEntry[]) {
  if (KV_URL && KV_TOKEN) {
    await kvCommand(["SET", KV_KEY, JSON.stringify(entries)]);
    return;
  }
  store.pragmaLeaderboard = new Map(entries.map((entry) => [entry.address, entry]));
}

function getSorted() {
  return [...store.pragmaLeaderboard!.values()].sort((a, b) => {
    const aVerified = a.verifiedBestScore ?? 0;
    const bVerified = b.verifiedBestScore ?? 0;
    if (bVerified !== aVerified) {
      return bVerified - aVerified;
    }
    if (b.bestScore !== a.bestScore) return b.bestScore - a.bestScore;
    return b.updatedAt - a.updatedAt;
  });
}

function normalizeAddress(value: string) {
  return value.trim().toLowerCase();
}

function xpForNextLevel(level: number) {
  return 40 + level * 30 + level * level * 6;
}

function normalizeEntry(entry: Partial<LeaderboardEntry> & { address: string }): LeaderboardEntry {
  return {
    address: normalizeAddress(entry.address),
    bestScore: Math.max(0, Math.floor(entry.bestScore ?? 0)),
    verifiedBestScore: Math.max(0, Math.floor(entry.verifiedBestScore ?? 0)),
    lastScore: Math.max(0, Math.floor(entry.lastScore ?? 0)),
    totalRuns: Math.max(0, Math.floor(entry.totalRuns ?? 0)),
    level: Math.max(1, Math.floor(entry.level ?? 1)),
    levelXp: Math.max(0, Math.floor(entry.levelXp ?? 0)),
    updatedAt: Math.max(0, Math.floor(entry.updatedAt ?? Date.now()))
  };
}

function applyXpProgress(level: number, levelXp: number, xpGained: number) {
  let currentLevel = Math.max(1, level);
  let currentLevelXp = Math.max(0, levelXp + Math.max(0, xpGained));
  while (currentLevelXp >= xpForNextLevel(currentLevel)) {
    currentLevelXp -= xpForNextLevel(currentLevel);
    currentLevel += 1;
  }
  return { level: currentLevel, levelXp: currentLevelXp };
}

function profileFromEntry(entry: LeaderboardEntry) {
  const nextXp = xpForNextLevel(entry.level);
  const damage = Number((1 + (entry.level - 1) * 0.15).toFixed(2));
  const maxHp = 3 + Math.floor((entry.level - 1) / 2);
  return {
    ...entry,
    nextLevelXp: nextXp,
    damage,
    maxHp
  };
}

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  const entries = await readEntries();
  const normalizedEntries = entries.map((entry) => normalizeEntry(entry));
  store.pragmaLeaderboard = new Map(normalizedEntries.map((entry) => [entry.address, entry]));
  const leaderboard = getSorted().slice(0, 100);
  if (!address) {
    return NextResponse.json({
      leaderboard: leaderboard.map((entry) => profileFromEntry(entry))
    });
  }
  const profile = store.pragmaLeaderboard!.get(normalizeAddress(address)) ?? null;
  return NextResponse.json({
    leaderboard: leaderboard.map((entry) => profileFromEntry(entry)),
    profile: profile ? profileFromEntry(profile) : null
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      address?: string;
      score?: number;
      verified?: boolean;
      xpGained?: number;
    };
    if (!body.address || typeof body.score !== "number") {
      return NextResponse.json({ error: "address and score are required" }, { status: 400 });
    }
    const address = normalizeAddress(body.address);
    if (!/^0x[a-f0-9]{40}$/.test(address)) {
      return NextResponse.json({ error: "invalid address" }, { status: 400 });
    }
    const score = Math.max(0, Math.floor(body.score));
    const verified = body.verified === true;
    const xpGained = Math.max(0, Math.floor(body.xpGained ?? 0));
    const entries = await readEntries();
    const normalizedEntries = entries.map((entry) => normalizeEntry(entry));
    const map = new Map(normalizedEntries.map((entry) => [entry.address, entry]));
    const prev = map.get(address);
    const xpProgress = applyXpProgress(prev?.level ?? 1, prev?.levelXp ?? 0, xpGained);
    const updated: LeaderboardEntry = {
      address,
      bestScore: Math.max(prev?.bestScore ?? 0, score),
      verifiedBestScore: verified
        ? Math.max(prev?.verifiedBestScore ?? 0, score)
        : (prev?.verifiedBestScore ?? 0),
      lastScore: score,
      totalRuns: (prev?.totalRuns ?? 0) + 1,
      level: xpProgress.level,
      levelXp: xpProgress.levelXp,
      updatedAt: Date.now()
    };
    map.set(address, updated);
    const updatedEntries = [...map.values()];
    await writeEntries(updatedEntries);
    store.pragmaLeaderboard = map;
    return NextResponse.json({
      profile: profileFromEntry(updated),
      leaderboard: getSorted()
        .slice(0, 100)
        .map((entry) => profileFromEntry(entry))
    });
  } catch {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }
}
