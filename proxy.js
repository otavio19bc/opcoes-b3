import { NextResponse } from "next/server";
import { COOKIE_NAME, expectedToken } from "@/lib/auth";

export async function proxy(request) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const valid = token && token === (await expectedToken());

  if (!valid) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!login|api/login|_next/static|_next/image|favicon.ico).*)",
  ],
};
