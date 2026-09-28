import { NextResponse } from "next/server";

import { getServerAuthSession } from "../../../lib/auth";
import { createAuditLog } from "../../../lib/audit";
import {
  getBlindSignaturePublicKey,
  signBlindedToken
} from "../../../lib/blindSignature";
import { Prisma } from "@prisma/client";
import prisma from "../../../lib/prisma";
import { getClientIp, getUserAgent, sha256Hex } from "../../../lib/request";
import { consumeRateLimit } from "../../../lib/rateLimit";

const DEFAULT_TOKEN_TTL_MINUTES = 15;
const DEFAULT_VERIFICATION_WINDOW_MINUTES = 15;

function getTokenTtlMs(): number {
  const envValue = Number(process.env.VOTE_TOKEN_TTL_MINUTES ?? DEFAULT_TOKEN_TTL_MINUTES);
  return Math.max(envValue, 1) * 60_000;
}

function getVerificationWindowMs(): number {
  const envValue = Number(
    process.env.BIOMETRIC_VERIFICATION_WINDOW_MINUTES ?? DEFAULT_VERIFICATION_WINDOW_MINUTES
  );

  return Math.max(envValue, 1) * 60_000;
}

type GenerateTokenRequestBody = {
  blindedToken?: string;
};

function normalizeBlindedToken(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim();
  return /^\d+$/.test(normalized) ? normalized : "";
}

export async function GET() {
  const publicKey = getBlindSignaturePublicKey();

  return NextResponse.json({
    E: publicKey.E,
    N: publicKey.N,
    modulusLengthBytes: publicKey.modulusLengthBytes
  });
}

export async function POST(request: Request) {
  const session = await getServerAuthSession();
  if (!session?.user || session.user.role !== "VOTANTE" || !session.user.voterId) {
    return NextResponse.json({ error: "Sesion no autorizada" }, { status: 401 });
  }

  let body: GenerateTokenRequestBody;
  try {
    body = (await request.json()) as GenerateTokenRequestBody;
  } catch {
    return NextResponse.json({ error: "El cuerpo JSON es invalido" }, { status: 400 });
  }

  const blindedToken = normalizeBlindedToken(body.blindedToken);
  if (!blindedToken) {
    return NextResponse.json(
      { error: "blindedToken es obligatorio y debe ser decimal" },
      { status: 400 }
    );
  }

  const clientIp = getClientIp(request.headers) ?? "unknown";
  const userAgent = getUserAgent(request.headers);
  const rateLimit = consumeRateLimit({
    identifier: `${clientIp}:${session.user.voterId}`,
    keyPrefix: "api:generar-token",
    limit: 6,
    windowMs: 10 * 60_000
  });

  if (!rateLimit.success) {
    return NextResponse.json(
      { error: "Demasiados intentos de generacion de token" },
      { status: 429 }
    );
  }

  const voter = await prisma.voter.findUnique({
    select: {
      estado: true,
      id: true,
      votoEmitido: true
    },
    where: {
      id: session.user.voterId
    }
  });

  if (!voter) {
    return NextResponse.json({ error: "Votante no encontrado" }, { status: 404 });
  }

  if (voter.votoEmitido || voter.estado === "VOTO_EMITIDO") {
    return NextResponse.json(
      { error: "El votante ya emitio su voto" },
      { status: 409 }
    );
  }

  const latestApprovedAttempt = await prisma.verificationAttempt.findFirst({
    orderBy: {
      resolvedAt: "desc"
    },
    where: {
      biometricMatch: true,
      resolvedAt: {
        not: null
      },
      status: "APROBADO",
      type: "LIVENESS",
      voterId: voter.id
    }
  });

  if (!latestApprovedAttempt?.resolvedAt) {
    return NextResponse.json(
      { error: "Primero debes completar la verificacion biometrica" },
      { status: 403 }
    );
  }

  if (Date.now() - latestApprovedAttempt.resolvedAt.getTime() > getVerificationWindowMs()) {
    return NextResponse.json(
      { error: "La verificacion biometrica expiro. Debes repetir el liveness check." },
      { status: 403 }
    );
  }

  const existingCredential = await prisma.voteToken.findFirst({
    select: {
      id: true,
      status: true
    },
    where: {
      status: {
        in: ["EMITIDO", "CONSUMIDO"]
      },
      voterId: voter.id
    }
  });

  if (existingCredential) {
    return NextResponse.json(
      { error: "Ya se emitio una credencial anonima para este votante" },
      { status: 409 }
    );
  }

  const expiresAt = new Date(Date.now() + getTokenTtlMs());
  const signedBlindedToken = signBlindedToken(blindedToken);
  const blindedTokenHash = sha256Hex(`blinded:${blindedToken}`);
  const signedBlindedTokenHash = sha256Hex(`signed-blinded:${signedBlindedToken}`);

  const voteToken = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    return tx.voteToken.create({
      data: {
        expiresAt,
        signedTokenHash: signedBlindedTokenHash,
        status: "EMITIDO",
        tokenHash: blindedTokenHash,
        verificationAttemptId: latestApprovedAttempt.id,
        voterId: voter.id
      },
      select: {
        id: true
      }
    });
  });

  await createAuditLog({
    action: "TOKEN_GENERADO",
    actorType: "SISTEMA",
    ipAddress: clientIp,
    metadata: {
      expiresAt: expiresAt.toISOString(),
      privacy: "blind_signature_final_token_unknown_to_server",
      verificationAttemptId: latestApprovedAttempt.id
    },
    resourceId: voteToken.id,
    resourceType: "vote_token",
    userAgent,
    voteTokenId: voteToken.id,
    voterId: voter.id
  });

  return NextResponse.json({
    expiresAt: expiresAt.toISOString(),
    signedBlindedToken
  });
}
