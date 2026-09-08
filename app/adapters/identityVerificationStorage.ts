import type {
  BiometricInitResponse,
  IdentityVerificationInitResponse,
  RegistrationInitResponse,
  VerificationStatus,
} from "../services/identityVerification";
import {
  getVerificationProvider,
  getVerificationSessionId,
  getVerificationUrl,
} from "./identityVerificationApi";

type StoredIdentityVerification = IdentityVerificationInitResponse & {
  savedAt: string;
};

const REGISTRATION_KEY = "votar:identity-verification:registration";
const BIOMETRIC_KEY = "votar:identity-verification:biometric";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const TERMINAL_STATUSES: VerificationStatus[] = [
  "APROBADO",
  "ERROR",
  "EXPIRADO",
  "RECHAZADO",
];

function canUseStorage(): boolean {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function isExpired(savedAt: string): boolean {
  const savedTime = new Date(savedAt).getTime();
  return Number.isNaN(savedTime) || Date.now() - savedTime > MAX_AGE_MS;
}

function toStored(
  attempt: IdentityVerificationInitResponse,
): StoredIdentityVerification {
  const sessionId = getVerificationSessionId(attempt);
  const url = getVerificationUrl(attempt);

  return {
    ...attempt,
    identityProvider: getVerificationProvider(attempt),
    savedAt: new Date().toISOString(),
    verificationSessionId: sessionId,
    verificationSessionToken: attempt.verificationSessionToken ?? null,
    verificationUrl: url,
    veriffSessionId: sessionId,
    veriffSessionToken: attempt.veriffSessionToken ?? null,
    veriffUrl: attempt.veriffUrl ?? url,
  };
}

function save(key: string, attempt: IdentityVerificationInitResponse): void {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(toStored(attempt)));
}

function load<T extends IdentityVerificationInitResponse>(key: string): T | null {
  if (!canUseStorage()) {
    return null;
  }

  const value = window.localStorage.getItem(key);
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as StoredIdentityVerification;
    if (isExpired(parsed.savedAt) || TERMINAL_STATUSES.includes(parsed.status)) {
      window.localStorage.removeItem(key);
      return null;
    }

    return parsed as unknown as T;
  } catch {
    window.localStorage.removeItem(key);
    return null;
  }
}

function clear(key: string): void {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.removeItem(key);
}

export function isTerminalVerificationStatus(status: VerificationStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function savePendingRegistrationVerification(
  attempt: RegistrationInitResponse,
): void {
  save(REGISTRATION_KEY, attempt);
}

export function loadPendingRegistrationVerification(): RegistrationInitResponse | null {
  return load<RegistrationInitResponse>(REGISTRATION_KEY);
}

export function clearPendingRegistrationVerification(): void {
  clear(REGISTRATION_KEY);
}

export function savePendingBiometricVerification(
  attempt: BiometricInitResponse,
): void {
  save(BIOMETRIC_KEY, attempt);
}

export function loadPendingBiometricVerification(): BiometricInitResponse | null {
  return load<BiometricInitResponse>(BIOMETRIC_KEY);
}

export function clearPendingBiometricVerification(): void {
  clear(BIOMETRIC_KEY);
}
