import type { Estado } from "@prisma/client";
import type { DefaultSession, DefaultUser } from "next-auth";
import type { JWT as DefaultJWT } from "next-auth/jwt";

type AuthRole = "VOTANTE" | "AUTORIDAD";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      estado?: Estado;
      id: string;
      role: AuthRole;
      sessionVersion?: number;
      voterId?: string;
    };
  }

  interface User extends DefaultUser {
    estado?: Estado;
    role: AuthRole;
    sessionVersion?: number;
    voterId?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    estado?: Estado;
    role?: AuthRole;
    sessionVersion?: number;
    voterId?: string;
  }
}
