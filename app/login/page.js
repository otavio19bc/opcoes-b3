"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const C = {
  bgGradient: "radial-gradient(ellipse 1200px 620px at 50% -12%, #161B2C 0%, #0B0E14 55%)",
  card: "#12161F",
  border: "#262C39",
  borderSoft: "#1D2230",
  accent: "#5B8DEF",
  red: "#F87171",
  text: "#EDEFF3",
  muted: "#8A94A6",
  input: "#171B24",
};

function ZapIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const entrar = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (r.ok) {
        router.push("/");
        router.refresh();
      } else {
        const d = await r.json().catch(() => ({}));
        setError(d.error || "Senha incorreta.");
      }
    } catch {
      setError("Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: C.bgGradient,
        color: C.text,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--font-sans), -apple-system, sans-serif",
        padding: 20,
      }}
    >
      <form
        onSubmit={entrar}
        style={{
          background: C.card,
          border: `1px solid ${C.borderSoft}`,
          borderRadius: 16,
          padding: 34,
          width: "100%",
          maxWidth: 340,
          boxShadow: "0 1px 2px rgba(0,0,0,0.2), 0 16px 40px rgba(0,0,0,0.35)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 26 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 13,
              background: "linear-gradient(135deg, #5B8DEF 0%, #7C6CF0 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              margin: "0 auto 14px",
              boxShadow: "0 4px 16px rgba(91,141,239,0.4)",
            }}
          >
            <ZapIcon />
          </div>
          <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: "-0.2px" }}>Opções B3</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
            Acesso restrito — versão beta
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              fontSize: 10,
              color: C.muted,
              marginBottom: 5,
              textTransform: "uppercase",
              letterSpacing: "0.6px",
              fontWeight: 600,
            }}
          >
            Senha de acesso
          </div>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="op-input"
            style={{
              width: "100%",
              background: C.input,
              border: `1px solid ${C.border}`,
              borderRadius: 9,
              padding: "11px 13px",
              color: C.text,
              fontSize: 14,
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>
        {error && (
          <div style={{ color: C.red, fontSize: 12, marginBottom: 14 }}>
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={loading}
          className="op-btn"
          style={{
            width: "100%",
            border: "none",
            borderRadius: 9,
            fontSize: 13.5,
            fontWeight: 600,
            cursor: loading ? "default" : "pointer",
            padding: "11px 16px",
            background: "linear-gradient(135deg, #5B8DEF 0%, #4C7FE0 100%)",
            color: "#fff",
            boxShadow: "0 2px 10px rgba(91,141,239,0.3)",
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </div>
  );
}
