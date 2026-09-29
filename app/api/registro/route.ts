import { NextResponse } from "next/server";

import { createAuditLog } from "../../../lib/audit";
import { hashDni } from "../../../lib/biometricHash";
import { Prisma } from "@prisma/client";
import prisma from "../../../lib/prisma";
import { getClientIp, getUserAgent, normalizeString } from "../../../lib/request";
import { consumeRateLimit } from "../../../lib/rateLimit";
import {
  getIdentityVerificationAdapter,
} from "../../../lib/identity-verification";
import { processIdentityVerificationAttempt } from "../../../lib/identityVerificationWorkflow";

type RegistroRequestBody = {
  dateOfBirth?: string;
  dni?: string;
  documentCountry?: string;
  documentType?: string;
  firstName?: string;
  lastName?: string;
};

export async function POST(request: Request) {
  const clientIp = getClientIp(request.headers) ?? "unknown";
  const userAgent = getUserAgent(request.headers);
  const rateLimit = await consumeRateLimit({
    identifier: clientIp,
    keyPrefix: "api:registro",
    limit: 5,
    windowMs: 60_000
  });

  if (!rateLimit.success) {
    return NextResponse.json(
      { error: "Demasiadas solicitudes de registro. Intenta nuevamente en unos minutos." },
      {
        headers: {
          "Retry-After": Math.ceil((rateLimit.resetAt - Date.now()) / 1000).toString()
        },
        status: 429
      }
    );
  }

  let body: RegistroRequestBody;
  try {
    body = (await request.json()) as RegistroRequestBody;
  } catch {
    return NextResponse.json({ error: "El cuerpo JSON es invalido" }, { status: 400 });
  }

  const dni = normalizeString(body.dni);
  const firstName = normalizeString(body.firstName);
  const lastName = normalizeString(body.lastName);
  const dateOfBirth = normalizeString(body.dateOfBirth);
  const documentCountry = normalizeString(body.documentCountry)?.toUpperCase();
  const documentType = normalizeString(body.documentType);

  if (!dni || !firstName || !lastName || !dateOfBirth || !documentCountry || !documentType) {
    return NextResponse.json(
      { error: "dni, firstName, lastName, dateOfBirth, documentCountry y documentType son obligatorios" },
      { status: 400 }
    );
  }

  const dniHash = hashDni(dni);

  const existingVoter = await prisma.voter.findUnique({
    select: {
      id: true
    },
    where: {
      dniHash
    }
  });

  if (existingVoter) {
    return NextResponse.json(
      { error: "El votante ya se encuentra registrado" },
      { status: 409 }
    );
  }

  const vendorData = dniHash;
  const identityVerification = getIdentityVerificationAdapter();

  // ── Sandbox mode: bypass provider and auto-approve ───────────────────────────
  if (identityVerification.isSandboxMode()) {
    const fakeSession = identityVerification.createSandboxSession();
    const sessionId = fakeSession.id;
    const biometricHash = identityVerification.sandboxBiometricHash(dniHash);
    const resolvedAt = new Date();

    const { attempt, voter } = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const newVoter = await tx.voter.create({
        data: {
          biometricHash,
          dniHash,
          estado: "VERIFICADO",
          veriffPersonId: sessionId,
          verifiedAt: resolvedAt
        },
        select: { estado: true, id: true }
      });

      const newAttempt = await tx.verificationAttempt.create({
        data: {
          biometricHash,
          biometricMatch: true,
          dniHash,
          referenceId: vendorData,
          resolvedAt,
          status: "APROBADO",
          type: "REGISTRO",
          veriffSessionId: sessionId,
          voterId: newVoter.id
        },
        select: { id: true, status: true, veriffSessionId: true }
      });

      return { attempt: newAttempt, voter: newVoter };
    });

    await createAuditLog({
      action: "REGISTRO_INICIADO",
      actorType: "VOTER",
      ipAddress: clientIp,
      metadata: {
        dniHash,
        identityProvider: identityVerification.provider,
        sandbox: true,
        sessionId
      },
      resourceId: attempt.id,
      resourceType: "verification_attempt",
      userAgent
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
        veriffUrl: fakeSession.url,
        voter: { estado: voter.estado, id: voter.id }
      },
      { status: 201 }
    );
  }

  // ── Flujo real con el proveedor de identidad ──────────────────────────────────
  try {
    const verificationSession = await identityVerification.createSession({
      callbackUrl: identityVerification.getCallbackUrl(),
      document: {
        country: documentCountry,
        number: dni,
        type: documentType
      },
      person: {
        dateOfBirth,
        firstName,
        idNumber: dni,
        lastName
      },
      vendorData
    });

    const attempt = await prisma.verificationAttempt.create({
      data: {
        dniHash,
        referenceId: vendorData,
        status: "PENDIENTE",
        type: "REGISTRO",
        veriffSessionId: verificationSession.id
      },
      select: {
        id: true,
        status: true,
        veriffSessionId: true
      }
    });

    await createAuditLog({
      action: "REGISTRO_INICIADO",
      actorType: "VOTER",
      ipAddress: clientIp,
      metadata: {
        dniHash,
        flow: "REGISTRO",
        identityProvider: verificationSession.provider,
        sessionId: verificationSession.id
      },
      resourceId: attempt.id,
      resourceType: "verification_attempt",
      userAgent
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
    console.error("No se pudo iniciar el registro en el proveedor de identidad", error);

    if (identityVerification.isConfigError(error)) {
      return NextResponse.json(
        { error: "Servicio de validacion no disponible" },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: "No se pudo iniciar la verificacion de identidad" },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  const clientIp = getClientIp(request.headers) ?? "unknown";
  const rateLimit = await consumeRateLimit({
    identifier: clientIp,
    keyPrefix: "api:registro:status",
    limit: 20,
    windowMs: 60_000
  });

  if (!rateLimit.success) {
    return NextResponse.json(
      { error: "Demasiadas consultas al estado de registro" },
      { status: 429 }
    );
  }

  const url = new URL(request.url);
  const attemptId = normalizeString(url.searchParams.get("attemptId"));
  const sessionId = normalizeString(url.searchParams.get("sessionId"));
  const shouldRefresh = url.searchParams.get("refresh") === "1";

  if (!attemptId && !sessionId) {
    return NextResponse.json(
      { error: "Debes indicar attemptId o sessionId" },
      { status: 400 }
    );
  }

  let attempt = await prisma.verificationAttempt.findFirst({
    where: {
      id: attemptId,
      type: "REGISTRO",
      veriffSessionId: sessionId
    }
  });

  if (!attempt) {
    attempt = await prisma.verificationAttempt.findFirst({
      where: {
        ...(attemptId ? { id: attemptId } : {}),
        ...(sessionId ? { veriffSessionId: sessionId } : {}),
        type: "REGISTRO"
      }
    });
  }

  if (!attempt) {
    return NextResponse.json(
      { error: "No existe un intento de registro para los parametros enviados" },
      { status: 404 }
    );
  }

  if (shouldRefresh && attempt.status === "PENDIENTE") {
    try {
      await processIdentityVerificationAttempt(attempt.veriffSessionId);
    } catch (error) {
      console.error("No se pudo refrescar el estado del registro en Veriff", error);
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

  const voter = attempt.dniHash
    ? await prisma.voter.findUnique({
        select: {
          createdAt: true,
          estado: true,
          id: true
        },
        where: {
          dniHash: attempt.dniHash
        }
      })
    : null;

  return NextResponse.json({
    attemptId: attempt.id,
    failureReason: attempt.failureReason,
    resolvedAt: attempt.resolvedAt?.toISOString() ?? null,
    status: attempt.status,
    veriffSessionId: attempt.veriffSessionId,
    voter: voter
      ? {
          createdAt: voter.createdAt.toISOString(),
          estado: voter.estado,
          id: voter.id
        }
      : null
  });
}
