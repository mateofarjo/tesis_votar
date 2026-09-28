import { timingSafeEqual } from "node:crypto";

import type { Estado } from "@prisma/client";
import type { NextAuthOptions, Session } from "next-auth";
import { getServerSession } from "next-auth/next";
import CredentialsProvider from "next-auth/providers/credentials";

import { hashDni } from "./biometricHash";
import { createAuditLog } from "./audit";
import prisma from "./prisma";
import { consumeLoginTicket } from "./webauthn";

export type AuthRole = "VOTANTE" | "AUTORIDAD";

type AppUser = {
  estado?: Estado;
  id: string;
  name: string;
  role: AuthRole;
  sessionVersion?: number;
  voterId?: string;
};

function normalizeString(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function getHeaderValue(
  headers: Record<string, string | string[] | undefined>,
  key: string
): string | undefined {
  const rawValue = headers[key] ?? headers[key.toLowerCase()];
  if (Array.isArray(rawValue)) {
    return rawValue[0];
  }

  return normalizeString(rawValue);
}

function getRequestIp(headers: Record<string, string | string[] | undefined>): string | undefined {
  const forwardedFor = getHeaderValue(headers, "x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim();
  }

  return getHeaderValue(headers, "x-real-ip");
}

async function authorizeAuthority(
  credentials: Record<string, string | undefined>,
  requestHeaders: Record<string, string | string[] | undefined>
): Promise<AppUser | null> {
  const username = normalizeString(credentials.username);
  const password = normalizeString(credentials.password);
  const expectedUsername = normalizeString(process.env.AUTHORITY_USERNAME);
  const expectedPassword = normalizeString(process.env.AUTHORITY_PASSWORD);

  if (!username || !password || !expectedUsername || !expectedPassword) {
    await createAuditLog({
      action: "LOGIN_FALLIDO",
      actorType: "AUTORIDAD",
      ipAddress: getRequestIp(requestHeaders),
      metadata: { attemptedRole: "AUTORIDAD" },
      userAgent: getHeaderValue(requestHeaders, "user-agent")
    });
    return null;
  }

  const isValid =
    constantTimeEqual(username, expectedUsername) &&
    constantTimeEqual(password, expectedPassword);

  if (!isValid) {
    await createAuditLog({
      action: "LOGIN_FALLIDO",
      actorType: "AUTORIDAD",
      ipAddress: getRequestIp(requestHeaders),
      metadata: { attemptedRole: "AUTORIDAD" },
      userAgent: getHeaderValue(requestHeaders, "user-agent")
    });
    return null;
  }

  await createAuditLog({
    action: "LOGIN_OK",
    actorType: "AUTORIDAD",
    ipAddress: getRequestIp(requestHeaders),
    metadata: { attemptedRole: "AUTORIDAD" },
    userAgent: getHeaderValue(requestHeaders, "user-agent")
  });

  return {
    id: "autoridad-electoral",
    name: "Autoridad Electoral",
    role: "AUTORIDAD"
  };
}

async function authorizeVoter(
  credentials: Record<string, string | undefined>,
  requestHeaders: Record<string, string | string[] | undefined>
): Promise<AppUser | null> {
  const ticket = normalizeString(credentials.passkeyTicket);
  if (!ticket) {
    await createAuditLog({
      action: "LOGIN_FALLIDO",
      actorType: "VOTER",
      ipAddress: getRequestIp(requestHeaders),
      metadata: { attemptedRole: "VOTANTE" },
      userAgent: getHeaderValue(requestHeaders, "user-agent")
    });
    return null;
  }

  const voter = await consumeLoginTicket(ticket);

  if (!voter) {
    await createAuditLog({
      action: "LOGIN_FALLIDO",
      actorType: "VOTER",
      ipAddress: getRequestIp(requestHeaders),
      metadata: {
        attemptedRole: "VOTANTE",
        reason: "passkey_ticket_invalid"
      },
      userAgent: getHeaderValue(requestHeaders, "user-agent")
    });
    return null;
  }

  await createAuditLog({
    action: "LOGIN_OK",
    actorType: "VOTER",
    ipAddress: getRequestIp(requestHeaders),
    metadata: {
      attemptedRole: "VOTANTE",
      passkey: true
    },
    userAgent: getHeaderValue(requestHeaders, "user-agent"),
    voterId: voter.id
  });

  return {
    estado: voter.estado,
    id: voter.id,
    name: `Votante ${voter.id.slice(0, 8)}`,
    role: "VOTANTE",
    sessionVersion: voter.sessionVersion,
    voterId: voter.id
  };
}

async function authorizeCredentials(
  credentials: Record<string, string> | undefined,
  requestHeaders: Record<string, string | string[] | undefined>
): Promise<AppUser | null> {
  const role = normalizeString(credentials?.role) as AuthRole | undefined;
  if (role !== "VOTANTE" && role !== "AUTORIDAD") {
    return null;
  }

  if (role === "AUTORIDAD") {
    return authorizeAuthority(credentials ?? {}, requestHeaders);
  }

  return authorizeVoter(credentials ?? {}, requestHeaders);
}

export const authOptions: NextAuthOptions = {
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.estado = user.estado;
        token.sessionVersion = user.sessionVersion;
        token.voterId = user.voterId;
      }

      return token;
    },
    async session({ session, token }) {
      return {
        ...session,
        user: {
          ...session.user,
          id: token.sub ?? "",
          role: token.role as AuthRole,
          sessionVersion: token.sessionVersion as number | undefined,
          estado: token.estado as Estado | undefined,
          voterId: token.voterId as string | undefined
        }
      };
    }
  },
  pages: {
    signIn: "/login"
  },
  providers: [
    CredentialsProvider({
      credentials: {
        dni: {
          label: "DNI",
          placeholder: "30111222",
          type: "text"
        },
        passkeyTicket: { label: "Passkey ticket", type: "text" },
        password: {
          label: "Password",
          type: "password"
        },
        role: {
          label: "Rol",
          placeholder: "VOTANTE o AUTORIDAD",
          type: "text"
        },
        username: {
          label: "Usuario autoridad",
          type: "text"
        }
      },
      name: "Credenciales",
      async authorize(credentials, req) {
        const requestHeaders = req.headers ?? {};
        return authorizeCredentials(credentials, requestHeaders);
      }
    })
  ],
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    maxAge: 60 * 60 * 8,
    strategy: "jwt"
  }
};

export async function getServerAuthSession() {
  const session = await getServerSession(authOptions);
  if (session?.user.role !== "VOTANTE" || !session.user.voterId) {
    return session;
  }

  const voter = await prisma.voter.findUnique({
    select: { sessionVersion: true },
    where: { id: session.user.voterId },
  });
  if (!voter || voter.sessionVersion !== session.user.sessionVersion) {
    return null;
  }

  return session;
}

export async function revokeVoterSessions(voterId: string): Promise<void> {
  await prisma.voter.update({
    data: { sessionVersion: { increment: 1 } },
    where: { id: voterId },
  });
}

export function assertRole(session: Session | null, role: AuthRole): asserts session is Session {
  if (!session?.user || session.user.role !== role) {
    throw new Error(`Sesion invalida para rol ${role}`);
  }
}
