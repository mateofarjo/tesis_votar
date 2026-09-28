import type {
  Estado,
  VerificationAttempt,
  VerificationStatus,
  VerificationType,
  Voter,
} from "@prisma/client";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";

import { createAuditLog } from "./audit";
import { hashBiometricVector, type JsonLike } from "./biometricHash";
import {
  getIdentityVerificationAdapter,
  type IdentityDecision,
} from "./identity-verification";
import prisma from "./prisma";

type AttemptWithVoter = VerificationAttempt & {
  voter: Voter | null;
};

const WEBHOOK_CLAIM_TTL_MS = 5 * 60_000;

function getDecisionHash(decision: IdentityDecision): string {
  return createHash("sha256").update(JSON.stringify(decision.raw)).digest("hex");
}

export type ProcessedIdentityAttemptResult =
  | {
      message: string;
      outcome: "already_processed" | "already_processing" | "missing_attempt";
      verificationStatus: VerificationStatus | null;
    }
  | {
      attemptId: string;
      message: string;
      outcome: "still_pending";
      verificationStatus: "PENDIENTE";
    }
  | {
      attemptId: string;
      message: string;
      outcome: "processed";
      verificationStatus: VerificationStatus;
      voterEstado?: Estado;
    };

function mapRejectedStatus(decision: IdentityDecision): VerificationStatus {
  return decision.status === "expired" ? "EXPIRADO" : "RECHAZADO";
}

async function finalizeRejectedAttempt(
  attempt: AttemptWithVoter,
  decision: IdentityDecision,
  reason: string,
): Promise<ProcessedIdentityAttemptResult> {
  const verificationStatus = mapRejectedStatus(decision);
  const resolvedAt = new Date();

  await prisma.verificationAttempt.update({
    data: {
      biometricScore: decision.biometricScore ?? null,
      failureReason: reason,
      identityProvider: decision.provider,
      providerDecisionHash: getDecisionHash(decision),
      resolvedAt,
      status: verificationStatus,
      veriffAttemptId: decision.attemptId ?? attempt.veriffAttemptId,
    },
    where: {
      id: attempt.id,
    },
  });

  await createAuditLog({
    action:
      attempt.type === "REGISTRO"
        ? "REGISTRO_RECHAZADO"
        : "BIOMETRIA_RECHAZADA",
    actorType: "WEBHOOK",
    metadata: {
      provider: decision.provider,
      providerStatus: decision.providerStatus ?? null,
      reason,
    },
    resourceId: attempt.id,
    resourceType: "verification_attempt",
    voterId: attempt.voterId ?? undefined,
  });

  return {
    attemptId: attempt.id,
    message: reason,
    outcome: "processed",
    verificationStatus,
  };
}

function getBiometricSource(decision: IdentityDecision): JsonLike {
  if (!decision.biometricSource) {
    throw new Error(
      `La decision de ${decision.provider} no contiene un bloque biometrico hasheable`,
    );
  }

  return decision.biometricSource as JsonLike;
}

async function processRegistrationApproval(
  attempt: AttemptWithVoter,
  decision: IdentityDecision,
): Promise<ProcessedIdentityAttemptResult> {
  if (!attempt.dniHash) {
    return finalizeRejectedAttempt(
      attempt,
      decision,
      "El intento de registro no tiene dniHash asociado",
    );
  }

  const biometricHash = hashBiometricVector(getBiometricSource(decision));
  const resolvedAt = new Date();

  const result = await prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      const existingByDni = await tx.voter.findUnique({
        where: {
          dniHash: attempt.dniHash!,
        },
      });

      const existingByBiometric = await tx.voter.findUnique({
        where: {
          biometricHash,
        },
      });

      if (
        existingByBiometric &&
        (!existingByDni || existingByBiometric.id !== existingByDni.id)
      ) {
        await tx.verificationAttempt.update({
          data: {
            biometricScore: decision.biometricScore ?? null,
            biometricHash,
            failureReason:
              "La biometria ya se encuentra asociada a otro votante",
            identityProvider: decision.provider,
            providerDecisionHash: getDecisionHash(decision),
            resolvedAt,
            status: "RECHAZADO",
            veriffAttemptId: decision.attemptId ?? attempt.veriffAttemptId,
          },
          where: {
            id: attempt.id,
          },
        });

        return {
          voterEstado: undefined,
          verificationStatus: "RECHAZADO" as VerificationStatus,
        };
      }

      const voter = existingByDni
        ? await tx.voter.update({
            data: {
              biometricHash,
              veriffPersonId: decision.personId ?? attempt.veriffSessionId,
            },
            where: {
              id: existingByDni.id,
            },
          })
        : await tx.voter.create({
            data: {
              biometricHash,
              dniHash: attempt.dniHash!,
              estado: "REGISTRADO",
              veriffPersonId: decision.personId ?? attempt.veriffSessionId,
            },
          });

      await tx.verificationAttempt.update({
        data: {
          biometricScore: decision.biometricScore ?? null,
          biometricHash,
          biometricMatch: null,
          failureReason: null,
          identityProvider: decision.provider,
          providerDecisionHash: getDecisionHash(decision),
          resolvedAt,
          status: "APROBADO",
          veriffAttemptId: decision.attemptId ?? attempt.veriffAttemptId,
          voterId: voter.id,
        },
        where: {
          id: attempt.id,
        },
      });

      return {
        voterEstado: voter.estado,
        verificationStatus: "APROBADO" as VerificationStatus,
      };
    },
  );

  if (result.verificationStatus === "RECHAZADO") {
    await createAuditLog({
      action: "REGISTRO_RECHAZADO",
      actorType: "WEBHOOK",
      metadata: {
        reason: "La biometria ya se encuentra asociada a otro votante",
      },
      resourceId: attempt.id,
      resourceType: "verification_attempt",
    });

    return {
      attemptId: attempt.id,
      message: "La biometria ya se encuentra asociada a otro votante",
      outcome: "processed",
      verificationStatus: "RECHAZADO",
    };
  }

  await createAuditLog({
    action: "REGISTRO_APROBADO",
    actorType: "WEBHOOK",
    metadata: {
      provider: decision.provider,
      sessionId: attempt.veriffSessionId,
    },
    resourceId: attempt.id,
    resourceType: "verification_attempt",
  });

  return {
    attemptId: attempt.id,
    message: "Registro biometrico aprobado",
    outcome: "processed",
    verificationStatus: "APROBADO",
    voterEstado: result.voterEstado,
  };
}

async function processLivenessApproval(
  attempt: AttemptWithVoter,
  decision: IdentityDecision,
): Promise<ProcessedIdentityAttemptResult> {
  if (!attempt.voter) {
    return finalizeRejectedAttempt(
      attempt,
      decision,
      "El intento de liveness no tiene un votante asociado",
    );
  }

  // Un hash de dos capturas no es un comparador facial. Solo se acepta el
  // veredicto de match explícito del proveedor contra la identidad registrada.
  const biometricHash = hashBiometricVector(getBiometricSource(decision));
  const biometricMatch =
    Boolean(decision.matchedIdentityReference) &&
    decision.matchedIdentityReference === attempt.voter.veriffPersonId;
  const resolvedAt = new Date();

  const updatedVoter = biometricMatch
    ? await prisma.voter.update({
        data:
          attempt.voter.estado === "VOTO_EMITIDO"
            ? {}
            : {
                estado: "VERIFICADO",
                verifiedAt: resolvedAt,
              },
        where: {
          id: attempt.voter.id,
        },
      })
    : attempt.voter;

  await prisma.verificationAttempt.update({
    data: {
      biometricScore: decision.biometricScore ?? null,
      biometricHash,
      biometricMatch,
      failureReason: biometricMatch
        ? null
        : "El proveedor no confirmo una coincidencia con la identidad registrada",
      identityProvider: decision.provider,
      providerDecisionHash: getDecisionHash(decision),
      resolvedAt,
      status: biometricMatch ? "APROBADO" : "RECHAZADO",
      veriffAttemptId: decision.attemptId ?? attempt.veriffAttemptId,
    },
    where: {
      id: attempt.id,
    },
  });

  await createAuditLog({
    action: biometricMatch ? "BIOMETRIA_VERIFICADA" : "BIOMETRIA_RECHAZADA",
    actorType: "WEBHOOK",
    metadata: {
      biometricMatch,
      provider: decision.provider,
      sessionId: attempt.veriffSessionId,
    },
    resourceId: attempt.id,
    resourceType: "verification_attempt",
    voterId: attempt.voter.id,
  });

  return {
    attemptId: attempt.id,
    message: biometricMatch
      ? "Liveness aprobado y biometria verificada"
      : "La biometria no coincide con el registro",
    outcome: "processed",
    verificationStatus: biometricMatch ? "APROBADO" : "RECHAZADO",
    voterEstado: updatedVoter.estado,
  };
}

async function processApprovedAttempt(
  attempt: AttemptWithVoter,
  decision: IdentityDecision,
): Promise<ProcessedIdentityAttemptResult> {
  return attempt.type === "REGISTRO"
    ? processRegistrationApproval(attempt, decision)
    : processLivenessApproval(attempt, decision);
}

export async function processIdentityVerificationAttempt(
  sessionId: string,
  decision?: IdentityDecision,
): Promise<ProcessedIdentityAttemptResult> {
  const initialAttempt = await prisma.verificationAttempt.findUnique({
    select: { id: true, status: true },
    where: {
      veriffSessionId: sessionId,
    },
  });

  if (!initialAttempt) {
    return {
      message: "No existe un intento asociado al sessionId recibido",
      outcome: "missing_attempt",
      verificationStatus: null,
    };
  }

  if (initialAttempt.status !== "PENDIENTE") {
    return {
      message: "El intento ya fue procesado previamente",
      outcome: "already_processed",
      verificationStatus: initialAttempt.status,
    };
  }

  const claimedAt = new Date();
  const reclaimBefore = new Date(claimedAt.getTime() - WEBHOOK_CLAIM_TTL_MS);
  const claim = await prisma.verificationAttempt.updateMany({
    data: { webhookClaimedAt: claimedAt },
    where: {
      id: initialAttempt.id,
      status: "PENDIENTE",
      OR: [
        { webhookClaimedAt: null },
        { webhookClaimedAt: { lt: reclaimBefore } },
      ],
    },
  });

  if (claim.count === 0) {
    return {
      message: "El intento esta siendo procesado por otra entrega del webhook",
      outcome: "already_processing",
      verificationStatus: "PENDIENTE",
    };
  }

  let releaseClaim = true;
  try {
    const attempt = await prisma.verificationAttempt.findUniqueOrThrow({
      include: { voter: true },
      where: { id: initialAttempt.id },
    });
    const authoritativeDecision =
      decision ?? (await getIdentityVerificationAdapter().getDecision(sessionId));

    if (authoritativeDecision.status === "approved") {
      const result = await processApprovedAttempt(attempt, authoritativeDecision);
      releaseClaim = false;
      return result;
    }

    if (authoritativeDecision.status === "pending") {
      return {
        attemptId: attempt.id,
        message: `${authoritativeDecision.provider} todavia no emitio una decision final`,
        outcome: "still_pending",
        verificationStatus: "PENDIENTE",
      };
    }

    const reason =
      authoritativeDecision.reason ??
      `${authoritativeDecision.provider} no aprobo la verificacion`;
    const result = await finalizeRejectedAttempt(attempt, authoritativeDecision, reason);
    releaseClaim = false;
    return result;
  } finally {
    if (releaseClaim) {
      await prisma.verificationAttempt.updateMany({
        data: { webhookClaimedAt: null },
        where: { id: initialAttempt.id, status: "PENDIENTE", webhookClaimedAt: claimedAt },
      });
    }
  }
}

export function isLivenessAttempt(attemptType: VerificationType): boolean {
  return attemptType === "LIVENESS";
}
