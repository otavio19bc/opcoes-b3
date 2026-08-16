import { createClient } from "@/lib/supabase/client";

// ════════════════════════════════════════════════════════════════════
// POSIÇÕES
// ════════════════════════════════════════════════════════════════════
function posicaoToDb(p) {
  return {
    ativo: p.ativo,
    tipo: p.tipo,
    codigo: p.codigoOpcao || null,
    data_lanc: p.dataLancamento || null,
    data_venc: p.dataVenc || null,
    data_enc: p.dataEncerramento || null,
    preco_entrada: p.precoEntrada,
    preco_saida: p.precoSaida === "" || p.precoSaida == null ? null : p.precoSaida,
    qtd: p.qtd,
    premio: p.premio,
    strike: p.strike,
    recompra: p.recompra === "" || p.recompra == null ? null : p.recompra,
    corretagem: p.corretagem || 0,
    status: p.status || "Aberta",
    obs: p.observacoes || null,
  };
}

function posicaoFromDb(r) {
  return {
    id: r.id,
    ativo: r.ativo,
    tipo: r.tipo,
    codigoOpcao: r.codigo || "",
    dataLancamento: r.data_lanc || "",
    dataVenc: r.data_venc || "",
    dataEncerramento: r.data_enc || "",
    precoEntrada: Number(r.preco_entrada),
    precoSaida: r.preco_saida == null ? "" : Number(r.preco_saida),
    qtd: r.qtd,
    premio: Number(r.premio),
    strike: Number(r.strike),
    recompra: r.recompra == null ? "" : Number(r.recompra),
    corretagem: Number(r.corretagem) || 0,
    status: r.status || "Aberta",
    observacoes: r.obs || "",
  };
}

export async function listPosicoes() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("posicoes")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map(posicaoFromDb);
}

export async function insertPosicao(p) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("posicoes")
    .insert(posicaoToDb(p))
    .select()
    .single();
  if (error) throw error;
  return posicaoFromDb(data);
}

export async function updatePosicao(id, patch) {
  const supabase = createClient();
  const { error } = await supabase.from("posicoes").update(posicaoToDb(patch)).eq("id", id);
  if (error) throw error;
}

export async function deletePosicao(id) {
  const supabase = createClient();
  const { error } = await supabase.from("posicoes").delete().eq("id", id);
  if (error) throw error;
}

// ════════════════════════════════════════════════════════════════════
// CONFIGURAÇÕES (uma linha por usuário — meta, capital, yield mínimo, selic)
// ════════════════════════════════════════════════════════════════════
function configFromDb(r) {
  if (!r) return null;
  return {
    metaMensal: r.meta_mensal,
    capitalTotal: r.capital_total,
    yieldMin: r.yield_min,
    taxaSelic: r.taxa_selic,
  };
}

export async function getConfig() {
  const supabase = createClient();
  const { data, error } = await supabase.from("configuracoes").select("*").maybeSingle();
  if (error) throw error;
  return configFromDb(data);
}

// Faz merge com o que já existe no servidor antes de salvar, para que
// duas abas diferentes (Performance e Preço Teto) editando campos
// diferentes da mesma linha não apaguem uma a mudança da outra.
export async function saveConfig(partial) {
  const supabase = createClient();
  const atual = await getConfig();
  const merged = { ...atual, ...partial };
  const { error } = await supabase.from("configuracoes").upsert(
    {
      meta_mensal: merged.metaMensal,
      capital_total: merged.capitalTotal,
      yield_min: merged.yieldMin,
      taxa_selic: merged.taxaSelic,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) throw error;
}

// ════════════════════════════════════════════════════════════════════
// ATIVOS SALVOS (Preço Teto — uma linha por ticker)
// ════════════════════════════════════════════════════════════════════
function ativoSalvoFromDb(r) {
  if (!r) return null;
  return {
    roe: r.roe != null ? String(r.roe) : "",
    dividaEbitda: r.divida_ebitda != null ? String(r.divida_ebitda) : "",
    dividendoAnual: r.dividendo_anual != null ? String(r.dividendo_anual) : "",
    respostas: r.respostas || {},
  };
}

export async function getAtivoSalvo(ticker) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("ativos_salvos")
    .select("*")
    .eq("ticker", ticker)
    .maybeSingle();
  if (error) throw error;
  return ativoSalvoFromDb(data);
}

export async function saveAtivoSalvo(ticker, { roe, dividaEbitda, dividendoAnual, respostas }) {
  const supabase = createClient();
  const { error } = await supabase.from("ativos_salvos").upsert(
    {
      ticker,
      roe: roe === "" || roe == null ? null : parseFloat(roe),
      divida_ebitda: dividaEbitda === "" || dividaEbitda == null ? null : parseFloat(dividaEbitda),
      dividendo_anual: dividendoAnual === "" || dividendoAnual == null ? null : parseFloat(dividendoAnual),
      respostas: respostas || {},
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,ticker" }
  );
  if (error) throw error;
}
