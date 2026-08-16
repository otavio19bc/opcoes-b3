# Opções B3 — Análise & Gestão

Ferramenta de análise de opções para o mercado brasileiro (B3): calcula IV via Black-Scholes,
volatilidade histórica automática (via [Brapi](https://brapi.dev)), compara strikes, simula
rolagem, calcula preço teto e acompanha performance mensal vs Selic.

Autenticação multiusuário via [Supabase Auth](https://supabase.com) (e-mail + senha) — cada
usuário tem seus próprios dados, salvos no Supabase Postgres e sincronizados entre dispositivos.

## Rodando localmente

```bash
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000). Você vai precisar das variáveis de ambiente
abaixo configuradas no `.env.local` (não é commitado no Git) antes do app funcionar.

## Variáveis de ambiente

| Nome | Descrição |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave pública (anon) do projeto Supabase |
| `BRAPI_TOKEN` | Token pessoal gratuito da Brapi (veja abaixo) |

### Configurando o Supabase

Veja o passo a passo completo na conversa com o assistente, ou resumidamente:

1. Crie um projeto em [supabase.com](https://supabase.com).
2. No SQL Editor do projeto, rode o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) —
   cria as tabelas `posicoes`, `configuracoes` e `ativos_salvos`, todas protegidas por Row Level
   Security (cada usuário só acessa os próprios dados).
3. Em **Project Settings → API**, copie a **Project URL** e a chave **anon/public**.
4. Cole em `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` no `.env.local` (local) e
   nas Environment Variables do Vercel (produção).
5. Em **Authentication → Providers → Email**, desative "Confirm email" para beta testes (permite
   login imediato após cadastro, sem precisar clicar em link de confirmação). Pode reativar depois.
6. Para restringir cadastro a convite apenas no futuro: **Authentication → Settings → User
   Signups**, desative "Allow new users to sign up".

### Obtendo um token da Brapi

Sem token, a Brapi só libera 4 ativos de teste (PETR4, VALE3, MGLU3, ITUB4). Para cotações de
qualquer ativo da B3:

1. Crie uma conta gratuita em [brapi.dev](https://brapi.dev).
2. No painel, gere seu token de API (plano gratuito: 15 mil requisições/mês).
3. Cole o token em `BRAPI_TOKEN`.

## Deploy no Vercel

1. Suba este repositório para o GitHub.
2. Em [vercel.com/new](https://vercel.com/new), importe o repositório.
3. Em **Environment Variables**, adicione `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   e `BRAPI_TOKEN`.
4. Deploy.

## Autenticação e dados

Login/cadastro por e-mail e senha via Supabase Auth (`app/login/page.js`). O `proxy.js` (rodando
em toda rota, exceto `/login`) verifica a sessão do Supabase a cada requisição e redireciona
quem não está logado. Toda a persistência de dados (posições, configurações, ativos salvos no
Preço Teto) passa por `lib/db.js`, que fala diretamente com o Supabase Postgres a partir do
navegador — a segurança vem das políticas de Row Level Security no banco, não do código do app.

## Integração com dados de mercado

Cotações e histórico de preços vêm da API da Brapi (`brapi.dev`). A rota `/api/brapi/[ticker]`
roda no servidor e injeta o `BRAPI_TOKEN` — o navegador nunca vê o token. A volatilidade
histórica é calculada a partir do histórico de fechamentos dos últimos 3 meses (desvio-padrão
dos log-retornos, anualizado).
