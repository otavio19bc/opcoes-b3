-- ════════════════════════════════════════════════════════════════════
-- Opções B3 — schema do banco (rodar uma vez no SQL Editor do Supabase)
-- Seguro rodar mais de uma vez (idempotente) se a query falhar no meio.
-- ════════════════════════════════════════════════════════════════════
create extension if not exists pgcrypto;

-- ── posições ────────────────────────────────────────────────────────
create table if not exists public.posicoes (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ativo          text not null,
  tipo           text not null check (tipo in ('call','put')),
  codigo         text,
  data_lanc      date,
  data_venc      date,
  data_enc       date,
  preco_entrada  numeric not null,
  preco_saida    numeric,
  qtd            integer not null,
  premio         numeric not null,
  strike         numeric not null,
  recompra       numeric,
  corretagem     numeric not null default 0,
  status         text not null default 'Aberta' check (status in ('Aberta','Encerrada','Exercida','Rolada')),
  obs            text,
  created_at     timestamptz not null default now()
);

create index if not exists posicoes_user_id_idx on public.posicoes(user_id);

alter table public.posicoes enable row level security;

drop policy if exists "posicoes: usuário vê/edita só as próprias" on public.posicoes;
create policy "posicoes: usuário vê/edita só as próprias"
  on public.posicoes
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── configurações (uma linha por usuário) ──────────────────────────
create table if not exists public.configuracoes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null unique default auth.uid() references auth.users(id) on delete cascade,
  meta_mensal   numeric not null default 2000,
  capital_total numeric not null default 50000,
  yield_min     numeric not null default 6,
  taxa_selic    numeric not null default 14,
  updated_at    timestamptz not null default now()
);

alter table public.configuracoes enable row level security;

drop policy if exists "configuracoes: usuário vê/edita só a própria" on public.configuracoes;
create policy "configuracoes: usuário vê/edita só a própria"
  on public.configuracoes
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── ativos salvos (Preço Teto — uma linha por usuário+ticker) ──────
create table if not exists public.ativos_salvos (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ticker           text not null,
  roe              numeric,
  divida_ebitda    numeric,
  dividendo_anual  numeric,
  respostas        jsonb not null default '{}'::jsonb,
  updated_at       timestamptz not null default now(),
  unique (user_id, ticker)
);

alter table public.ativos_salvos enable row level security;

drop policy if exists "ativos_salvos: usuário vê/edita só os próprios" on public.ativos_salvos;
create policy "ativos_salvos: usuário vê/edita só os próprios"
  on public.ativos_salvos
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
