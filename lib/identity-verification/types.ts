export type IdentityProviderId = "didit" | "veriff";

export type IdentitySessionRequest = {
  callbackUrl: string;
  document?: {
    country: string;
    number: string;
    type: string;
  };
  person?: {
    dateOfBirth: string;
    firstName: string;
    idNumber: string;
    lastName: string;
  };
  // Identidad estable emitida durante el registro, usada por el proveedor al
  // comparar la sesión de liveness con el registro previo.
  referenceIdentityId?: string;
  vendorData: string;
};

export type IdentitySession = {
  id: string;
  provider: IdentityProviderId;
  token: string | null;
  url: string | null;
};

export type IdentityDecisionStatus =
  | "approved"
  | "declined"
  | "expired"
  | "pending";

export type IdentityDecision = {
  attemptId?: string | null;
  biometricSource?: unknown;
  biometricScore?: number | null;
  // Evidencia de la identidad/sesión de registro contra la que el proveedor
  // realizó el match. vendorData no constituye evidencia biométrica.
  matchedIdentityReference?: string | null;
  personId?: string | null;
  provider: IdentityProviderId;
  providerStatus?: string | null;
  raw: unknown;
  reason?: string | null;
  sessionId?: string | null;
  status: IdentityDecisionStatus;
};

export type IdentityWebhookPayload = {
  decision?: IdentityDecision;
  raw: unknown;
  sessionId: string;
  status?: string | null;
};

export type IdentityVerificationAdapter = {
  assertWebhookHmac(rawBody: string, headers: Headers): void;
  createSandboxSession(): IdentitySession;
  createSession(request: IdentitySessionRequest): Promise<IdentitySession>;
  getCallbackUrl(): string;
  getDecision(sessionId: string): Promise<IdentityDecision>;
  isConfigError(error: unknown): boolean;
  isSandboxMode(): boolean;
  parseWebhook(rawBody: string): IdentityWebhookPayload;
  provider: IdentityProviderId;
  sandboxBiometricHash(seed: string): string;
};
