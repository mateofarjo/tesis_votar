import {
  adaptBiometricStatus,
  adaptIdentityVerificationInit,
  adaptRegistrationInit,
  adaptRegistrationStatus,
  getVerificationProvider,
  getVerificationSessionId,
  getVerificationUrl,
  initRegistrationStatusFromAttempt,
} from "../adapters/identityVerificationApi";
import { readApiJson } from "../adapters/apiResponse";

export {
  getVerificationProvider,
  getVerificationSessionId,
  getVerificationUrl,
  initRegistrationStatusFromAttempt,
} from "../adapters/identityVerificationApi";

export type VerificationStatus =
  | "APROBADO"
  | "ERROR"
  | "EXPIRADO"
  | "PENDIENTE"
  | "RECHAZADO";

export type IdentityVerificationInitResponse = {
  attemptId: string;
  identityProvider?: string;
  sandbox?: boolean;
  status: VerificationStatus;
  verificationSessionId?: string;
  verificationSessionToken?: string | null;
  verificationUrl?: string | null;
  veriffSessionId: string;
  veriffSessionToken: string | null;
  veriffUrl: string | null;
};

export type RegistrationFormPayload = {
  dateOfBirth: string;
  dni: string;
  documentCountry: string;
  documentType: string;
  firstName: string;
  lastName: string;
};

export type RegistrationInitResponse = IdentityVerificationInitResponse & {
  voter?: {
    createdAt?: string;
    estado: string;
    id: string;
  } | null;
};

export type RegistrationStatusResponse = {
  attemptId: string;
  failureReason: string | null;
  resolvedAt: string | null;
  status: VerificationStatus;
  veriffSessionId: string;
  voter: {
    createdAt: string;
    estado: string;
    id: string;
  } | null;
};

export type BiometricInitResponse = IdentityVerificationInitResponse;

export type BiometricStatusResponse = {
  attemptId: string;
  biometricMatch: boolean | null;
  failureReason: string | null;
  resolvedAt: string | null;
  status: VerificationStatus;
  veriffSessionId: string;
  voterEstado: string | null;
  votoEmitido: boolean;
};

export async function createRegistrationVerification(
  payload: RegistrationFormPayload,
): Promise<RegistrationInitResponse> {
  const response = await fetch("/api/registro", {
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  return adaptRegistrationInit(
    await readApiJson<RegistrationInitResponse>(
      response,
      "No se pudo iniciar el registro",
    ),
  );
}

export async function getRegistrationVerificationStatus({
  attemptId,
  refresh = false,
  sessionId,
}: {
  attemptId: string;
  refresh?: boolean;
  sessionId: string;
}): Promise<RegistrationStatusResponse> {
  const params = new URLSearchParams({
    attemptId,
    sessionId,
  });
  if (refresh) {
    params.set("refresh", "1");
  }

  const response = await fetch(`/api/registro?${params.toString()}`, {
    cache: "no-store",
  });

  return adaptRegistrationStatus(
    await readApiJson<RegistrationStatusResponse>(
      response,
      "No se pudo consultar el estado del registro",
    ),
  );
}

export async function createBiometricVerification(): Promise<BiometricInitResponse> {
  const response = await fetch("/api/verificar-biometria", {
    method: "POST",
  });

  return adaptIdentityVerificationInit(
    await readApiJson<BiometricInitResponse>(
      response,
      "No se pudo iniciar la verificación biométrica",
    ),
  );
}

export async function getBiometricVerificationStatus({
  refresh = false,
  sessionId,
}: {
  refresh?: boolean;
  sessionId?: string;
} = {}): Promise<BiometricStatusResponse | null> {
  const params = new URLSearchParams();
  if (sessionId) {
    params.set("sessionId", sessionId);
  }
  if (refresh) {
    params.set("refresh", "1");
  }
  const query = params.toString();
  const response = await fetch(
    `/api/verificar-biometria${query ? `?${query}` : ""}`,
    { cache: "no-store" },
  );

  if (response.status === 404) {
    return null;
  }

  return adaptBiometricStatus(
    await readApiJson<BiometricStatusResponse>(
      response,
      "No se pudo consultar el estado biométrico",
    ),
  );
}
