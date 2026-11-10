import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, authRequired, isValidSession } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  if (!authRequired()) return NextResponse.next();
  if (await isValidSession(request.cookies.get(AUTH_COOKIE)?.value)) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // Everything except the login page, the Notion webhook and static assets.
  matcher: ["/((?!login|api/notion/webhook|_next/static|_next/image|favicon.ico).*)"],
};
