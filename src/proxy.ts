import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySessionToken } from "@/lib/auth/session";
import { sameRequestOrigin } from "@/lib/auth/request-origin";

export default async function proxy(request: NextRequest) {
  if (request.headers.get("x-internal-key") && request.headers.get("x-internal-key") === process.env.SESSION_SECRET) return NextResponse.next();
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    if (!sameRequestOrigin(request)) return NextResponse.json({ error: "Use the application page to make changes." }, { status: 403 });
  }
  const session = request.cookies.get("cs_operations_session")?.value;
  if (await verifySessionToken(session)) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "Your session expired. Sign in again." }, { status: 401 });
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!api/auth|api/health|login|_next/static|_next/image|favicon.ico).*)"],
};
