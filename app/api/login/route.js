import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, expectedToken, isCorrectPassword } from "@/lib/auth";

export async function POST(request) {
  const body = await request.json().catch(() => null);
  const password = body?.password;

  if (!password || !(await isCorrectPassword(password))) {
    return NextResponse.json({ error: "Senha incorreta." }, { status: 401 });
  }

  const token = await expectedToken();
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return NextResponse.json({ ok: true });
}
