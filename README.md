# Opções B3 — Análise & Gestão

Ferramenta de análise de opções para o mercado brasileiro (B3): calcula IV via Black-Scholes,
volatilidade histórica automática (via [Brapi](https://brapi.dev)), compara strikes, simula
rolagem e acompanha performance mensal vs Selic.

Acesso protegido por senha única (para beta testers), configurada pela variável de ambiente
`APP_PASSWORD`.

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

## Deploy no Vercel

1. Suba este repositório para o GitHub.
2. Em [vercel.com/new](https://vercel.com/new), importe o repositório.
3. Em **Environment Variables**, adicione `APP_PASSWORD` com a senha desejada.
4. Deploy.

## Integração com dados de mercado

Cotações e histórico de preços vêm da API pública da Brapi (`brapi.dev`), chamada direto do
navegador (sem chave de API). A volatilidade histórica é calculada a partir do histórico de
fechamentos dos últimos 3 meses (desvio-padrão dos log-retornos, anualizado).
