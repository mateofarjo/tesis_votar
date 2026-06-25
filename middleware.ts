import { type NextRequestWithAuth, withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

import type { AuthRole } from "./lib/auth";

export default withAuth(
  function middleware(req: NextRequestWithAuth) {
    const { pathname } = req.nextUrl;
    const role = req.nextauth.token?.role as AuthRole | undefined;

    if (pathname.startsWith("/admin") && role !== "AUTORIDAD") {
      return NextResponse.redirect(new URL("/unauthorized", req.url));
    }

    if (pathname.startsWith("/votar") && role !== "VOTANTE") {
      return NextResponse.redirect(new URL("/unauthorized", req.url));
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      // Any authenticated user passes here; role checks happen in the function above.
      // Unauthenticated users (token === null) are redirected to pages.signIn.
      authorized: ({ token }) => token !== null,
    },
    pages: {
      signIn: "/login",
    },
  }
);

export const config = {
  matcher: ["/votar", "/votar/:path*", "/admin", "/admin/:path*"],
};
