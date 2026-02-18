import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const paymasterUrl = process.env.PAYMASTER_SERVICE_URL;
  if (!paymasterUrl) {
    return NextResponse.json(
      { error: "PAYMASTER_SERVICE_URL is not configured" },
      { status: 500 }
    );
  }

  try {
    const body = await request.text();
    const upstream = await fetch(paymasterUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body,
      cache: "no-store"
    });

    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "content-type": "application/json" }
    });
  } catch {
    return NextResponse.json({ error: "Paymaster proxy request failed" }, { status: 502 });
  }
}

