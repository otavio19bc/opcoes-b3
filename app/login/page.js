"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const C = {
  bgGradient: "radial-gradient(ellipse 1200px 620px at 50% -12%, #FFFFFF 0%, #F3F5F9 55%)",
  card: "#FFFFFF",
  border: "#DCE1E9",
  borderSoft: "#E8EBF1",
  accent: "#3563E0",
  green: "#059669",
  red: "#DC2626",
  text: "#0F172A",
  muted: "#64748B",
  input: "#F7F9FC",
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
  const [modo, setModo] = useState("entrar"); // "entrar" | "cadastrar"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);
    const supabase = createClient();
    try {
      if (modo === "entrar") {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        router.push("/");
        router.refresh();
      } else {
        const { data, error: err } = await supabase.auth.signUp({ email, password });
        if (err) throw err;
        if (data.session) {
          router.push("/");
          router.refresh();
        } else {
          setInfo("Conta criada! Verifique seu e-mail para confirmar o cadastro antes de entrar.");
          setModo("entrar");
        }
      }
    } catch (err) {
      setError(traduzErro(err.message));
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
        onSubmit={submit}
        style={{
          background: C.card,
          border: `1px solid ${C.borderSoft}`,
          borderRadius: 16,
          padding: 34,
          width: "100%",
          maxWidth: 360,
          boxShadow: "0 1px 2px rgba(15,23,42,0.05), 0 16px 40px rgba(15,23,42,0.12)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 22 }}>
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
            {modo === "entrar" ? "Entre com sua conta" : "Crie sua conta"}
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, color: C.muted, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.6px", fontWeight: 600 }}>
            E-mail
          </div>
          <input
            type="email"
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="op-input"
            style={{
              width: "100%", background: C.input, border: `1px solid ${C.border}`, borderRadius: 9,
              padding: "11px 13px", color: C.text, fontSize: 14, outline: "none", boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: C.muted, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.6px", fontWeight: 600 }}>
            Senha
          </div>
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="op-input"
            style={{
              width: "100%", background: C.input, border: `1px solid ${C.border}`, borderRadius: 9,
              padding: "11px 13px", color: C.text, fontSize: 14, outline: "none", boxSizing: "border-box",
            }}
          />
        </div>

        {error && <div style={{ color: C.red, fontSize: 12, marginBottom: 14 }}>{error}</div>}
        {info && <div style={{ color: C.green, fontSize: 12, marginBottom: 14, lineHeight: 1.5 }}>{info}</div>}

        <button
          type="submit"
          disabled={loading}
          className="op-btn"
          style={{
            width: "100%", border: "none", borderRadius: 9, fontSize: 13.5, fontWeight: 600,
            cursor: loading ? "default" : "pointer", padding: "11px 16px",
            background: "linear-gradient(135deg, #5B8DEF 0%, #4C7FE0 100%)", color: "#fff",
            boxShadow: "0 2px 10px rgba(91,141,239,0.3)", opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? "Aguarde..." : modo === "entrar" ? "Entrar" : "Criar conta"}
        </button>

        <button
          type="button"
          onClick={() => { setModo(modo === "entrar" ? "cadastrar" : "entrar"); setError(""); setInfo(""); }}
          style={{
            width: "100%", marginTop: 12, background: "transparent", border: "none",
            color: C.muted, fontSize: 12, cursor: "pointer", textAlign: "center",
          }}
        >
          {modo === "entrar" ? "Não tem conta? Cadastre-se" : "Já tem conta? Entrar"}
        </button>
      </form>
    </div>
  );
}

function traduzErro(msg) {
  if (!msg) return "Erro desconhecido.";
  if (msg.includes("Invalid login credentials")) return "E-mail ou senha incorretos.";
  if (msg.includes("User already registered")) return "Já existe uma conta com esse e-mail.";
  if (msg.includes("Password should be at least")) return "A senha precisa ter pelo menos 6 caracteres.";
  if (msg.includes("Unable to validate email address")) return "E-mail inválido.";
  return msg;
}
