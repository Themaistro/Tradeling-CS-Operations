import { NextResponse } from "next/server";
import { createSessionToken, SESSION_MAX_AGE } from "@/lib/auth/session";
import { sameRequestOrigin } from "@/lib/auth/request-origin";
const attempts = new Map<string, { count: number; until: number }>();

export async function POST(request: Request) {
  if (!sameRequestOrigin(request)) return NextResponse.json({ error: "Sign in from the application page." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const address = request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "local";
  const now = Date.now();
  for (const [key, item] of attempts) if (item.until <= now) attempts.delete(key);
  const attempt = attempts.get(address) || { count: 0, until: now + 15 * 60 * 1000 };
  if (attempt.count >= 10 || attempts.size >= 1000) return NextResponse.json({ error: "Too many sign-in attempts. Try again later." }, { status: 429 });
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "admin";

  if (body?.username !== username || body?.password !== password) {
    attempt.count++; attempts.set(address, attempt);
    return NextResponse.json({ error: "Incorrect username or password." }, { status: 401 });
  }
  attempts.delete(address);

  const response = NextResponse.json({ success: true });
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const secure = forwardedProtocol ? forwardedProtocol === "https" : new URL(request.url).protocol === "https:";
  response.cookies.set("cs_operations_session", await createSessionToken(), {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set("cs_operations_session", "", { httpOnly: true, expires: new Date(0), path: "/" });
  return response;
}
