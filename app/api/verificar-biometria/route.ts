import { NextResponse } from "next/server";

import { getServerAuthSession } from "../../../lib/auth";
import { createAuditLog } from "../../../lib/audit";
import prisma from "../../../lib/prisma";
import { getClientIp, getUserAgent } from "../../../lib/request";
import { consumeRateLimit } from "../../../lib/rateLimit";
import {
  getIdentityVerificationAdapter,
} from "../../../lib/identity-verification";
import { processIdentityVerificationAttempt } from "../../../lib/identityVerificationWorkflow";

export async function POST(request: Request) {
  const session = await getServerAuthSession();
  if (!session?.user || session.user.role !== "VOTANTE" || !session.user.voterId) {
    return NextResponse.json({ error: "Sesion no autorizada" }, { status: 401 });
  }

  const clientIp = getClientIp(request.headers) ?? "unknown";
  const userAgent = getUserAgent(request.headers);
  const rateLimit = consumeRateLimit({
    identifier: `${clientIp}:${session.user.voterId}`,
    keyPrefix: "api:verificar-biometria:init",
    limit: 5,
    windowMs: 10 * 60_000
  });

  if (!rateLimit.success) {
    return NextResponse.json(
      { error: "Demasiados intentos de verificacion biometrica" },
      { status: 429 }
    );
  }

  const voter = await prisma.voter.findUnique({
    select: {
      dniHash: true,
      estado: true,
      id: true,
      veriffPersonId: true,
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

  const vendorData = voter.dniHash ?? voter.id;
  const identityVerification = getIdentityVerificationAdapter();

  // ── Sandbox mode: bypass provider y auto-aprobar ─────────────────────────────
  if (identityVerification.isSandboxMode()) {
    const fakeSession = identityVerification.createSandboxSession();
    const sessionId = fakeSession.id;
    const biometricHash = identityVerification.sandboxBiometricHash(voter.dniHash ?? voter.id);
    const resolvedAt = new Date();

    const attempt = await prisma.verificationAttempt.create({
      data: {
        biometricHash,
        biometricMatch: true,
        dniHash: voter.dniHash,
        referenceId: vendorData,
        resolvedAt,
        status: "APROBADO",
        type: "LIVENESS",
        veriffSessionId: sessionId,
        voterId: voter.id
      },
      select: { id: true, status: true, veriffSessionId: true }
    });

    await prisma.voter.update({
      data: { biometricHash },
      where: { id: voter.id }
    });

    return NextResponse.json(
      {
        attemptId: attempt.id,
        sandbox: true,
        status: attempt.status,
        identityProvider: identityVerification.provider,
        verificationSessionId: sessionId,
        verificationSessionToken: fakeSession.token,
        verificationUrl: fakeSession.url,
        veriffSessionId: sessionId,
        veriffSessionToken: fakeSession.token,
        veriffUrl: fakeSession.url
      },
      { status: 201 }
    );
  }

  // ── Flujo real con el proveedor de identidad ──────────────────────────────────
  try {
    const verificationSession = await identityVerification.createSession({
      callbackUrl: identityVerification.getCallbackUrl(),
      referenceIdentityId: voter.veriffPersonId ?? undefined,
      vendorData
    });

    const attempt = await prisma.verificationAttempt.create({
      data: {
        dniHash: voter.dniHash,
        referenceId: vendorData,
        status: "PENDIENTE",
        type: "LIVENESS",
        veriffSessionId: verificationSession.id,
        voterId: voter.id
      },
      select: {
        id: true,
        status: true,
        veriffSessionId: true
      }
    });

    return NextResponse.json(
      {
        attemptId: attempt.id,
        status: attempt.status,
        identityProvider: verificationSession.provider,
        verificationSessionId: verificationSession.id,
        verificationSessionToken: verificationSession.token,
        verificationUrl: verificationSession.url,
        veriffSessionId: verificationSession.id,
        veriffSessionToken: verificationSession.token,
        veriffUrl: verificationSession.url
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("No se pudo iniciar el liveness check", error);

    await createAuditLog({
      action: "BIOMETRIA_RECHAZADA",
      actorType: "SISTEMA",
      ipAddress: clientIp,
      metadata: {
        reason: "No se pudo iniciar el liveness check"
      },
      resourceType: "verification_attempt",
      userAgent,
      voterId: voter.id
    });

    if (identityVerification.isConfigError(error)) {
      return NextResponse.json(
        { error: "Servicio de validacion no disponible" },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: "No se pudo iniciar la verificacion biometrica" },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  const session = await getServerAuthSession();
  if (!session?.user || session.user.role !== "VOTANTE" || !session.user.voterId) {
    return NextResponse.json({ error: "Sesion no autorizada" }, { status: 401 });
  }

  const clientIp = getClientIp(request.headers) ?? "unknown";
  const rateLimit = consumeRateLimit({
    identifier: `${clientIp}:${session.user.voterId}`,
    keyPrefix: "api:verificar-biometria:status",
    limit: 30,
    windowMs: 60_000
  });

  if (!rateLimit.success) {
    return NextResponse.json(
      { error: "Demasiadas consultas al estado biometrico" },
      { status: 429 }
    );
  }

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId")?.trim() || undefined;
  const shouldRefresh = url.searchParams.get("refresh") === "1";

  let attempt = sessionId
    ? await prisma.verificationAttempt.findFirst({
        where: {
          type: "LIVENESS",
          veriffSessionId: sessionId,
          voterId: session.user.voterId
        }
      })
    : await prisma.verificationAttempt.findFirst({
        orderBy: {
          createdAt: "desc"
        },
        where: {
          type: "LIVENESS",
          voterId: session.user.voterId
        }
      });

  if (!attempt) {
    return NextResponse.json(
      { error: "No existe un intento de verificacion biometrica para este votante" },
      { status: 404 }
    );
  }

  if (shouldRefresh && attempt.status === "PENDIENTE") {
    try {
      await processIdentityVerificationAttempt(attempt.veriffSessionId);
    } catch (error) {
      console.error("No se pudo refrescar el estado biometrico desde el proveedor de identidad", error);
    }

    const refreshedAttempt = await prisma.verificationAttempt.findUnique({
      where: {
        id: attempt.id
      }
    });

    if (refreshedAttempt) {
      attempt = refreshedAttempt;
    }
  }

  const voter = await prisma.voter.findUnique({
    select: {
      estado: true,
      votoEmitido: true
    },
    where: {
      id: session.user.voterId
    }
  });

  return NextResponse.json({
    attemptId: attempt.id,
    biometricMatch: attempt.biometricMatch,
    failureReason: attempt.failureReason,
    resolvedAt: attempt.resolvedAt,
    status: attempt.status,
    veriffSessionId: attempt.veriffSessionId,
    voterEstado: voter?.estado ?? null,
    votoEmitido: voter?.votoEmitido ?? false
  });
}
