import { NextResponse } from "next/server";

export async function GET(request, { params }) {
  const { ticker } = await params;
  const token = process.env.BRAPI_TOKEN;

  if (!token) {
    return NextResponse.json(
      { error: "BRAPI_TOKEN não configurado no servidor." },
      { status: 500 }
    );
  }

  const brapiRes = await fetch(
    `https://brapi.dev/api/quote/${encodeURIComponent(ticker)}?range=3mo&interval=1d&token=${token}`
  );
  const data = await brapiRes.json().catch(() => null);
  const result = data?.results?.[0];

  if (!result) {
    return NextResponse.json({ price: null, prices: [] }, { status: 404 });
  }

  const price = result.regularMarketPrice ?? null;
  const prices = (result.historicalDataPrice || [])
    .map((h) => h.close)
    .filter(Boolean);

  return NextResponse.json({ price, prices });
}
