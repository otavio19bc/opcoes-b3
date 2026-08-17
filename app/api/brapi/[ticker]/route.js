import { NextResponse } from "next/server";

export async function GET(request, { params }) {
  const { ticker } = await params;
  const { searchParams } = new URL(request.url);
  const wantStats = searchParams.get("stats") === "1";
  const token = process.env.BRAPI_TOKEN;

  if (!token) {
    return NextResponse.json(
      { error: "BRAPI_TOKEN não configurado no servidor." },
      { status: 500 }
    );
  }

  // Cotação básica funciona pra qualquer ticker com token pessoal — busca sempre,
  // independente do módulo de fundamentos (que o plano gratuito só libera pra
  // um punhado de ações de teste, ver abaixo).
  const baseQs = new URLSearchParams({ token, range: "3mo", interval: "1d" });
  const baseRes = await fetch(
    `https://brapi.dev/api/quote/${encodeURIComponent(ticker)}?${baseQs.toString()}`
  );
  const baseData = await baseRes.json().catch(() => null);
  const result = baseData?.results?.[0];

  if (!result) {
    return NextResponse.json({ price: null, prices: [] }, { status: 404 });
  }

  const price = result.regularMarketPrice ?? null;

  if (!wantStats) {
    const prices = (result.historicalDataPrice || [])
      .map((h) => h.close)
      .filter(Boolean);
    return NextResponse.json({ price, prices });
  }

  // defaultKeyStatistics (LPA, VPA, dividend yield) é módulo pago no plano
  // gratuito da Brapi pra maioria dos tickers — best-effort, sem derrubar o preço.
  let dks = {};
  try {
    const statsQs = new URLSearchParams({
      token,
      range: "3mo",
      interval: "1d",
      modules: "defaultKeyStatistics",
    });
    const statsRes = await fetch(
      `https://brapi.dev/api/quote/${encodeURIComponent(ticker)}?${statsQs.toString()}`
    );
    const statsData = await statsRes.json().catch(() => null);
    const statsResult = statsData?.results?.[0];
    if (statsResult && !statsData?.error) {
      dks = statsResult.defaultKeyStatistics || {};
    }
  } catch {}

  return NextResponse.json({
    price,
    dividendYield: typeof dks.dividendYield === "number" ? dks.dividendYield * 100 : null,
    pl: typeof dks.trailingPE === "number" ? dks.trailingPE : null,
    eps: typeof dks.trailingEps === "number" ? dks.trailingEps : null,
    vpa: typeof dks.bookValue === "number" ? dks.bookValue : null,
  });
}
