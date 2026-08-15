import { NextResponse } from "next/server";

export async function GET(request, { params }) {
  const { ticker } = await params;
  const { searchParams } = new URL(request.url);
  const wantFundamentals = searchParams.get("fundamentals") === "1";
  const token = process.env.BRAPI_TOKEN;

  if (!token) {
    return NextResponse.json(
      { error: "BRAPI_TOKEN não configurado no servidor." },
      { status: 500 }
    );
  }

  const modules = wantFundamentals
    ? "&modules=defaultKeyStatistics,financialData,summaryProfile"
    : "";
  const brapiRes = await fetch(
    `https://brapi.dev/api/quote/${encodeURIComponent(ticker)}?range=3mo&interval=1d&token=${token}${modules}`
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

  if (!wantFundamentals) {
    return NextResponse.json({ price, prices });
  }

  const dks = result.defaultKeyStatistics || {};
  const sp = result.summaryProfile || {};

  return NextResponse.json({
    price,
    prices,
    dividendYield: typeof dks.dividendYield === "number" ? dks.dividendYield * 100 : null,
    pl: typeof dks.trailingPE === "number" ? dks.trailingPE : null,
    eps: typeof dks.trailingEps === "number" ? dks.trailingEps : null,
    setor: sp.sector || null,
  });
}
