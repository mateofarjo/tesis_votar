import type {
  BiometricStatusResponse,
  IdentityVerificationInitResponse,
  RegistrationInitResponse,
  RegistrationStatusResponse,
} from "../services/identityVerification";

type IdentityInitWireResponse = IdentityVerificationInitResponse;
type RegistrationStatusWireResponse = RegistrationStatusResponse;
type BiometricStatusWireResponse = BiometricStatusResponse;

export function adaptIdentityVerificationInit(
  payload: IdentityInitWireResponse,
): IdentityVerificationInitResponse {
  return {
    ...payload,
    identityProvider: payload.identityProvider ?? "veriff",
    verificationSessionId:
      payload.verificationSessionId ?? payload.veriffSessionId,
    verificationSessionToken:
      payload.verificationSessionToken ?? payload.veriffSessionToken,
    verificationUrl: payload.verificationUrl ?? payload.veriffUrl,
  };
}

export function adaptRegistrationInit(
  payload: RegistrationInitResponse,
): RegistrationInitResponse {
  return {
    ...adaptIdentityVerificationInit(payload),
    voter: payload.voter ?? null,
  };
}

export function adaptRegistrationStatus(
  payload: RegistrationStatusWireResponse,
): RegistrationStatusResponse {
  return {
    attemptId: payload.attemptId,
    failureReason: payload.failureReason,
    resolvedAt: payload.resolvedAt,
    status: payload.status,
    veriffSessionId: payload.veriffSessionId,
    voter: payload.voter,
  };
}

export function adaptBiometricStatus(
  payload: BiometricStatusWireResponse,
): BiometricStatusResponse {
  return {
    attemptId: payload.attemptId,
    biometricMatch: payload.biometricMatch,
    failureReason: payload.failureReason,
    resolvedAt: payload.resolvedAt,
    status: payload.status,
    veriffSessionId: payload.veriffSessionId,
    voterEstado: payload.voterEstado,
  };
}

export function getVerificationProvider(payload: {
  identityProvider?: string;
}): string {
  return payload.identityProvider ?? "veriff";
}

export function getVerificationSessionId(payload: {
  verificationSessionId?: string;
  veriffSessionId: string;
}): string {
  return payload.verificationSessionId ?? payload.veriffSessionId;
}

export function getVerificationUrl(payload: {
  verificationUrl?: string | null;
  veriffUrl: string | null;
}): string | null {
  return payload.verificationUrl ?? payload.veriffUrl;
}

export function initRegistrationStatusFromAttempt(
  attempt: RegistrationInitResponse,
): RegistrationStatusResponse {
  return {
    attemptId: attempt.attemptId,
    failureReason: null,
    resolvedAt: attempt.status === "PENDIENTE" ? null : new Date().toISOString(),
    status: attempt.status,
    veriffSessionId: getVerificationSessionId(attempt),
    voter: attempt.voter
      ? {
          createdAt: attempt.voter.createdAt ?? new Date().toISOString(),
          estado: attempt.voter.estado,
          id: attempt.voter.id,
        }
      : null,
  };
}
