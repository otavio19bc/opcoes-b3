import { NextResponse } from "next/server";

export async function GET(request, { params }) {
  const { ticker } = await params;
  const { searchParams } = new URL(request.url);
  const wantDividends = searchParams.get("dividends") === "1";
  const token = process.env.BRAPI_TOKEN;

  if (!token) {
    return NextResponse.json(
      { error: "BRAPI_TOKEN não configurado no servidor." },
      { status: 500 }
    );
  }

  const qs = new URLSearchParams({ token });
  if (wantDividends) {
    qs.set("range", "5y");
    qs.set("interval", "1mo");
    qs.set("dividends", "true");
    qs.set("modules", "defaultKeyStatistics");
  } else {
    qs.set("range", "3mo");
    qs.set("interval", "1d");
  }

  const brapiRes = await fetch(
    `https://brapi.dev/api/quote/${encodeURIComponent(ticker)}?${qs.toString()}`
  );
  const data = await brapiRes.json().catch(() => null);
  const result = data?.results?.[0];

  if (!result) {
    return NextResponse.json({ price: null, prices: [] }, { status: 404 });
  }

  const price = result.regularMarketPrice ?? null;

  if (!wantDividends) {
    const prices = (result.historicalDataPrice || [])
      .map((h) => h.close)
      .filter(Boolean);
    return NextResponse.json({ price, prices });
  }

  const dks = result.defaultKeyStatistics || {};
  const dividends = (result.dividendsData?.cashDividends || [])
    .map((d) => ({ date: d.paymentDate || d.approvedOn, value: d.rate }))
    .filter((d) => d.date && typeof d.value === "number");

  return NextResponse.json({
    price,
    dividendYield: typeof dks.dividendYield === "number" ? dks.dividendYield * 100 : null,
    pl: typeof dks.trailingPE === "number" ? dks.trailingPE : null,
    eps: typeof dks.trailingEps === "number" ? dks.trailingEps : null,
    dividends,
  });
}
