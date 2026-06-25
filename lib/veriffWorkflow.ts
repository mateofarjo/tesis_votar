import type {
  Estado,
  VerificationAttempt,
  VerificationStatus,
  VerificationType,
  Voter
} from "@prisma/client";

import { compareSha256Hashes, hashBiometricVector, type JsonLike } from "./biometricHash";
import { createAuditLog } from "./audit";
import prisma from "./prisma";
import {
  extractBiometricSourceForHash,
  getVeriffDecision,
  isApprovedVeriffDecision,
  type VeriffDecisionPayload
} from "./veriff";

type AttemptWithVoter = VerificationAttempt & {
  voter: Voter | null;
};

export type ProcessedVeriffAttemptResult =
  | {
      message: string;
      outcome: "already_processed" | "missing_attempt";
      verificationStatus: VerificationStatus | null;
    }
  | {
      attemptId: string;
      message: string;
      outcome: "processed";
      verificationStatus: VerificationStatus;
      voterEstado?: Estado;
    };

function mapRejectedStatus(payload: VeriffDecisionPayload): VerificationStatus {
  const veriffStatus = payload.verification?.status;
  if (veriffStatus === "expired" || veriffStatus === "abandoned") {
    return "EXPIRADO";
  }

  return "RECHAZADO";
}

async function finalizeRejectedAttempt(
  attempt: AttemptWithVoter,
  payload: VeriffDecisionPayload,
  reason: string
): Promise<ProcessedVeriffAttemptResult> {
  const verificationStatus = mapRejectedStatus(payload);
  const resolvedAt = new Date();

  await prisma.verificationAttempt.update({
    data: {
      failureReason: reason,
      resolvedAt,
      status: verificationStatus,
      veriffAttemptId: payload.verification?.attemptId ?? attempt.veriffAttemptId
    },
    where: {
      id: attempt.id
    }
  });

  await createAuditLog({
    action: attempt.type === "REGISTRO" ? "REGISTRO_RECHAZADO" : "BIOMETRIA_RECHAZADA",
    actorType: "WEBHOOK",
    metadata: {
      reason,
      veriffStatus: payload.verification?.status ?? null
    },
    resourceId: attempt.id,
    resourceType: "verification_attempt",
    voterId: attempt.voterId ?? undefined
  });

  return {
    attemptId: attempt.id,
    message: reason,
    outcome: "processed",
    verificationStatus
  };
}

async function processRegistrationApproval(
  attempt: AttemptWithVoter,
  payload: VeriffDecisionPayload
): Promise<ProcessedVeriffAttemptResult> {
  if (!attempt.dniHash) {
    return finalizeRejectedAttempt(
      attempt,
      payload,
      "El intento de registro no tiene dniHash asociado"
    );
  }

  const biometricSource = extractBiometricSourceForHash(payload) as JsonLike;
  const biometricHash = hashBiometricVector(biometricSource);
  const resolvedAt = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const existingByDni = await tx.voter.findUnique({
      where: {
        dniHash: attempt.dniHash!
      }
    });

    const existingByBiometric = await tx.voter.findUnique({
      where: {
        biometricHash
      }
    });

    if (existingByBiometric && (!existingByDni || existingByBiometric.id !== existingByDni.id)) {
      await tx.verificationAttempt.update({
        data: {
          biometricHash,
          failureReason: "La biometria ya se encuentra asociada a otro votante",
          resolvedAt,
          status: "RECHAZADO",
          veriffAttemptId: payload.verification?.attemptId ?? attempt.veriffAttemptId
        },
        where: {
          id: attempt.id
        }
      });

      return {
        voterEstado: undefined,
        verificationStatus: "RECHAZADO" as VerificationStatus
      };
    }

    const voter = existingByDni
      ? await tx.voter.update({
          data: {
            biometricHash,
            veriffPersonId: payload.verification?.id ?? attempt.veriffSessionId
          },
          where: {
            id: existingByDni.id
          }
        })
      : await tx.voter.create({
          data: {
            biometricHash,
            dniHash: attempt.dniHash!,
            estado: "REGISTRADO",
            veriffPersonId: payload.verification?.id ?? attempt.veriffSessionId
          }
        });

    await tx.verificationAttempt.update({
      data: {
        biometricHash,
        biometricMatch: null,
        failureReason: null,
        resolvedAt,
        status: "APROBADO",
        veriffAttemptId: payload.verification?.attemptId ?? attempt.veriffAttemptId,
        voterId: voter.id
      },
      where: {
        id: attempt.id
      }
    });

    return {
      voterEstado: voter.estado,
      verificationStatus: "APROBADO" as VerificationStatus
    };
  });

  if (result.verificationStatus === "RECHAZADO") {
    await createAuditLog({
      action: "REGISTRO_RECHAZADO",
      actorType: "WEBHOOK",
      metadata: {
        reason: "La biometria ya se encuentra asociada a otro votante"
      },
      resourceId: attempt.id,
      resourceType: "verification_attempt"
    });

    return {
      attemptId: attempt.id,
      message: "La biometria ya se encuentra asociada a otro votante",
      outcome: "processed",
      verificationStatus: "RECHAZADO"
    };
  }

  await createAuditLog({
    action: "REGISTRO_APROBADO",
    actorType: "WEBHOOK",
    metadata: {
      veriffSessionId: attempt.veriffSessionId
    },
    resourceId: attempt.id,
    resourceType: "verification_attempt"
  });

  return {
    attemptId: attempt.id,
    message: "Registro biometrico aprobado",
    outcome: "processed",
    verificationStatus: "APROBADO",
    voterEstado: result.voterEstado
  };
}

async function processLivenessApproval(
  attempt: AttemptWithVoter,
  payload: VeriffDecisionPayload
): Promise<ProcessedVeriffAttemptResult> {
  if (!attempt.voter) {
    return finalizeRejectedAttempt(
      attempt,
      payload,
      "El intento de liveness no tiene un votante asociado"
    );
  }

  const biometricSource = extractBiometricSourceForHash(payload) as JsonLike;
  const biometricHash = hashBiometricVector(biometricSource);
  const biometricMatch = compareSha256Hashes(attempt.voter.biometricHash, biometricHash);
  const resolvedAt = new Date();

  const updatedVoter = biometricMatch
    ? await prisma.voter.update({
        data: attempt.voter.estado === "VOTO_EMITIDO"
          ? {}
          : {
              estado: "VERIFICADO",
              verifiedAt: resolvedAt
            },
        where: {
          id: attempt.voter.id
        }
      })
    : attempt.voter;

  await prisma.verificationAttempt.update({
    data: {
      biometricHash,
      biometricMatch,
      failureReason: biometricMatch ? null : "La biometria no coincide con el registro",
      resolvedAt,
      status: biometricMatch ? "APROBADO" : "RECHAZADO",
      veriffAttemptId: payload.verification?.attemptId ?? attempt.veriffAttemptId
    },
    where: {
      id: attempt.id
    }
  });

  await createAuditLog({
    action: biometricMatch ? "BIOMETRIA_VERIFICADA" : "BIOMETRIA_RECHAZADA",
    actorType: "WEBHOOK",
    metadata: {
      biometricMatch,
      veriffSessionId: attempt.veriffSessionId
    },
    resourceId: attempt.id,
    resourceType: "verification_attempt",
    voterId: attempt.voter.id
  });

  return {
    attemptId: attempt.id,
    message: biometricMatch
      ? "Liveness aprobado y biometria verificada"
      : "La biometria no coincide con el registro",
    outcome: "processed",
    verificationStatus: biometricMatch ? "APROBADO" : "RECHAZADO",
    voterEstado: updatedVoter.estado
  };
}

async function processApprovedAttempt(
  attempt: AttemptWithVoter,
  payload: VeriffDecisionPayload
): Promise<ProcessedVeriffAttemptResult> {
  return attempt.type === "REGISTRO"
    ? processRegistrationApproval(attempt, payload)
    : processLivenessApproval(attempt, payload);
}

export async function processVeriffAttempt(
  sessionId: string,
  payload?: VeriffDecisionPayload
): Promise<ProcessedVeriffAttemptResult> {
  const attempt = await prisma.verificationAttempt.findUnique({
    include: {
      voter: true
    },
    where: {
      veriffSessionId: sessionId
    }
  });

  if (!attempt) {
    return {
      message: "No existe un intento asociado al sessionId recibido",
      outcome: "missing_attempt",
      verificationStatus: null
    };
  }

  if (attempt.status !== "PENDIENTE") {
    return {
      message: "El intento ya fue procesado previamente",
      outcome: "already_processed",
      verificationStatus: attempt.status
    };
  }

  const authoritativePayload = payload ?? (await getVeriffDecision(sessionId));
  if (isApprovedVeriffDecision(authoritativePayload)) {
    return processApprovedAttempt(attempt, authoritativePayload);
  }

  const reason =
    authoritativePayload.verification?.reason ??
    authoritativePayload.verification?.reasonCode ??
    "Veriff no aprobo la verificacion";

  return finalizeRejectedAttempt(attempt, authoritativePayload, reason);
}

export function isLivenessAttempt(attemptType: VerificationType): boolean {
  return attemptType === "LIVENESS";
}
