import "./globals.css";

export const metadata = {
  title: "Opções B3 — Análise & Gestão",
  description: "Ferramenta de análise de opções para o mercado brasileiro (B3)",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
