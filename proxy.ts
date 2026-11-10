import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, authToken, passwordRequired } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  if (!passwordRequired()) return NextResponse.next();

  const password = process.env.SITE_PASSWORD;
  const cookie = request.cookies.get(AUTH_COOKIE)?.value;
  if (password && cookie && cookie === (await authToken(password))) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL("/login", request.url);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the login page, the Notion webhook and static assets.
  matcher: ["/((?!login|api/notion/webhook|_next/static|_next/image|favicon.ico).*)"],
};
