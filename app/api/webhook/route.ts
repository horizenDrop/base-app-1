import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    await request.text();
  } catch {
    // Ignore malformed payloads and still acknowledge delivery.
  }
  return NextResponse.json({ ok: true });
}

