"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const C = {
  bg: "#0D1117",
  card: "#161B22",
  border: "#30363D",
  accent: "#58A6FF",
  red: "#F85149",
  text: "#E6EDF3",
  muted: "#8B949E",
  input: "#21262D",
};

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
        background: C.bg,
        color: C.text,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        padding: 20,
      }}
    >
      <form
        onSubmit={entrar}
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: 32,
          width: "100%",
          maxWidth: 340,
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>⚡</div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Opções B3</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
            Acesso restrito — beta
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              fontSize: 10,
              color: C.muted,
              marginBottom: 4,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Senha de acesso
          </div>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{
              width: "100%",
              background: C.input,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              padding: "10px 12px",
              color: C.text,
              fontSize: 14,
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>
        {error && (
          <div style={{ color: C.red, fontSize: 12, marginBottom: 12 }}>
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            border: "none",
            borderRadius: 7,
            fontSize: 13,
            fontWeight: 600,
            cursor: loading ? "default" : "pointer",
            padding: "10px 16px",
            background: C.accent,
            color: "#fff",
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </div>
  );
}
