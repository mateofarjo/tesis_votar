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
  matchedVendorData?: string | null;
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
