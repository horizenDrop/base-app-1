import { NextRequest, NextResponse } from "next/server";

type LeaderboardEntry = {
  address: string;
  bestScore: number;
  verifiedBestScore: number;
  lastScore: number;
  totalRuns: number;
  updatedAt: number;
};

const store = globalThis as unknown as {
  pragmaLeaderboard?: Map<string, LeaderboardEntry>;
};

if (!store.pragmaLeaderboard) {
  store.pragmaLeaderboard = new Map<string, LeaderboardEntry>();
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

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  const leaderboard = getSorted().slice(0, 100);
  if (!address) return NextResponse.json({ leaderboard });
  const profile = store.pragmaLeaderboard!.get(normalizeAddress(address)) ?? null;
  return NextResponse.json({ leaderboard, profile });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      address?: string;
      score?: number;
      verified?: boolean;
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
    const prev = store.pragmaLeaderboard!.get(address);
    const updated: LeaderboardEntry = {
      address,
      bestScore: Math.max(prev?.bestScore ?? 0, score),
      verifiedBestScore: verified
        ? Math.max(prev?.verifiedBestScore ?? 0, score)
        : (prev?.verifiedBestScore ?? 0),
      lastScore: score,
      totalRuns: (prev?.totalRuns ?? 0) + 1,
      updatedAt: Date.now()
    };
    store.pragmaLeaderboard!.set(address, updated);
    return NextResponse.json({
      profile: updated,
      leaderboard: getSorted().slice(0, 100)
    });
  } catch {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }
}
