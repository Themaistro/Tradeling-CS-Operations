import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySessionToken } from "@/lib/auth/session";

export default async function proxy(request: NextRequest) {
  if (request.headers.get("x-internal-key") && request.headers.get("x-internal-key") === process.env.SESSION_SECRET) return NextResponse.next();
  const session = request.cookies.get("cs_operations_session")?.value;
  if (await verifySessionToken(session)) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!api/auth|api/health|login|_next/static|_next/image|favicon.ico).*)"],
};
