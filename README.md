# Opções B3 — Análise & Gestão

Ferramenta de análise de opções para o mercado brasileiro (B3): calcula IV via Black-Scholes,
volatilidade histórica automática (via [Brapi](https://brapi.dev)), compara strikes, simula
rolagem e acompanha performance mensal vs Selic.

Acesso protegido por senha única (para beta testers), configurada pela variável de ambiente
`APP_PASSWORD`. Cotações vêm da [Brapi](https://brapi.dev) usando um token pessoal gratuito
(`BRAPI_TOKEN`) — veja abaixo como obter o seu.

## Rodando localmente

```bash
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000). A senha padrão local está em `.env.local`
(não é commitada no Git).

## Variáveis de ambiente

| Nome | Descrição |
|---|---|
| `APP_PASSWORD` | Senha única que libera o acesso ao app |
| `BRAPI_TOKEN` | Token pessoal gratuito da Brapi (veja abaixo) |

### Obtendo um token da Brapi

Sem token, a Brapi só libera 4 ativos de teste (PETR4, VALE3, MGLU3, ITUB4). Para cotações de
qualquer ativo da B3:

1. Crie uma conta gratuita em [brapi.dev](https://brapi.dev).
2. No painel, gere seu token de API (plano gratuito: 15 mil requisições/mês).
3. Cole o token em `BRAPI_TOKEN` no `.env.local` (local) e nas Environment Variables do Vercel
   (produção).

## Deploy no Vercel

1. Suba este repositório para o GitHub.
2. Em [vercel.com/new](https://vercel.com/new), importe o repositório.
3. Em **Environment Variables**, adicione `APP_PASSWORD` e `BRAPI_TOKEN`.
4. Deploy.

## Integração com dados de mercado

Cotações e histórico de preços vêm da API da Brapi (`brapi.dev`). A rota `/api/brapi/[ticker]`
roda no servidor e injeta o `BRAPI_TOKEN` — o navegador nunca vê o token, e a rota já está
protegida pelo mesmo gate de senha do resto do app. A volatilidade histórica é calculada a
partir do histórico de fechamentos dos últimos 3 meses (desvio-padrão dos log-retornos,
anualizado).
