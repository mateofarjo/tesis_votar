import {
  assertVeriffWebhookHmac,
  createVeriffSession,
  createVeriffSessionSandbox,
  extractBiometricSourceForHash,
  getVeriffCallbackUrl,
  getVeriffDecision,
  isSandboxMode,
  isVeriffConfigError,
  sandboxBiometricHash,
  type VeriffDecisionPayload,
} from "../../veriff";
import type {
  IdentityDecision,
  IdentitySession,
  IdentitySessionRequest,
  IdentityVerificationAdapter,
  IdentityWebhookPayload,
} from "../types";

function normalizeVeriffDecision(payload: VeriffDecisionPayload): IdentityDecision {
  const providerStatus = payload.verification?.status ?? null;
  const isApproved = payload.status === "success" && providerStatus === "approved";
  const isExpired = providerStatus === "expired" || providerStatus === "abandoned";
  const isDeclined = providerStatus === "declined";
  const status = isApproved
    ? "approved"
    : isExpired
      ? "expired"
      : isDeclined
        ? "declined"
        : "pending";

  let biometricSource: unknown;
  if (isApproved) {
    biometricSource = extractBiometricSourceForHash(payload);
  }

  return {
    attemptId: payload.verification?.attemptId ?? null,
    biometricSource,
    matchedVendorData:
      payload.verification?.biometricAuthentication?.matchedSessionVendorData ?? null,
    personId: payload.verification?.id ?? null,
    provider: "veriff",
    providerStatus,
    raw: payload,
    reason:
      payload.verification?.reason ??
      payload.verification?.reasonCode ??
      null,
    sessionId: payload.verification?.id ?? null,
    status,
  };
}

export const veriffAdapter: IdentityVerificationAdapter = {
  assertWebhookHmac(rawBody, headers) {
    assertVeriffWebhookHmac(rawBody, headers);
  },
  createSandboxSession(): IdentitySession {
    const session = createVeriffSessionSandbox();
    return {
      id: session.verification!.id,
      provider: "veriff",
      token: session.verification?.sessionToken ?? null,
      url: session.verification?.url ?? null,
    };
  },
  async createSession(request: IdentitySessionRequest): Promise<IdentitySession> {
    const session = await createVeriffSession({
      verification: {
        callback: request.callbackUrl,
        document: request.document,
        person: request.person,
        timestamp: new Date().toISOString(),
        vendorData: request.vendorData,
      },
    });
    const verification = session.verification;

    if (!verification?.id) {
      throw new Error("Veriff no devolvio un identificador de sesion valido");
    }

    return {
      id: verification.id,
      provider: "veriff",
      token: verification.sessionToken ?? null,
      url: verification.url ?? null,
    };
  },
  getCallbackUrl: getVeriffCallbackUrl,
  async getDecision(sessionId: string): Promise<IdentityDecision> {
    return normalizeVeriffDecision(await getVeriffDecision(sessionId));
  },
  isConfigError: isVeriffConfigError,
  isSandboxMode,
  parseWebhook(rawBody: string): IdentityWebhookPayload {
    const payload = JSON.parse(rawBody) as VeriffDecisionPayload;
    const sessionId = payload.verification?.id;
    if (!sessionId) {
      throw new Error("El webhook no incluye verification.id");
    }

    return {
      decision: normalizeVeriffDecision(payload),
      raw: payload,
      sessionId,
      status: payload.verification?.status ?? null,
    };
  },
  provider: "veriff",
  sandboxBiometricHash,
};
