import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import type {
  IdentityDecision,
  IdentitySession,
  IdentitySessionRequest,
  IdentityVerificationAdapter,
  IdentityWebhookPayload,
} from "../types";

type DiditSessionResponse = {
  session_id: string;
  session_token?: string;
  status?: string;
  url?: string;
  verification_url?: string;
};

type DiditPayload = Record<string, unknown>;

const DEFAULT_DIDIT_BASE_URL = "https://verification.didit.me";

function getDiditConfig() {
  const apiKey = process.env.DIDIT_API_KEY?.trim();
  const workflowId = process.env.DIDIT_WORKFLOW_ID?.trim();
  const webhookSecret = process.env.DIDIT_WEBHOOK_SECRET?.trim();
  const baseUrl =
    process.env.DIDIT_BASE_URL?.trim() || DEFAULT_DIDIT_BASE_URL;

  if (!apiKey) {
    throw new Error("Falta DIDIT_API_KEY en el entorno");
  }

  if (!workflowId) {
    throw new Error("Falta DIDIT_WORKFLOW_ID en el entorno");
  }

  return {
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    webhookSecret,
    workflowId,
  };
}

function getDiditWebhookSecret() {
  const webhookSecret = getDiditConfig().webhookSecret;
  if (!webhookSecret) {
    throw new Error("Falta DIDIT_WEBHOOK_SECRET en el entorno");
  }

  return webhookSecret;
}

function getHeader(headers: Headers, name: string): string | undefined {
  return headers.get(name) ?? headers.get(name.toLowerCase()) ?? undefined;
}

function assertRecentTimestamp(timestampHeader: string | undefined) {
  const timestamp = Number(timestampHeader);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > 300) {
    throw new Error("Timestamp de webhook Didit invalido o expirado");
  }
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function timingSafeHexEqual(expected: string, received: string | undefined): boolean {
  if (!received) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(received.trim(), "hex");
  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "null";
}

function mapDocumentType(type: string): string {
  const types: Record<string, string> = {
    DRIVERS_LICENSE: "DL",
    ID_CARD: "ID",
    PASSPORT: "P",
    RESIDENCE_PERMIT: "RP",
  };

  return types[type] ?? type;
}

function mapCountryToAlpha3(country: string | undefined): string | undefined {
  if (!country) {
    return undefined;
  }

  const normalized = country.trim().toUpperCase();
  if (normalized.length === 3) {
    return normalized;
  }

  const alpha2ToAlpha3: Record<string, string> = {
    AR: "ARG",
    BO: "BOL",
    BR: "BRA",
    CL: "CHL",
    CO: "COL",
    CR: "CRI",
    CU: "CUB",
    DO: "DOM",
    EC: "ECU",
    ES: "ESP",
    GT: "GTM",
    HN: "HND",
    MX: "MEX",
    NI: "NIC",
    PA: "PAN",
    PE: "PER",
    PR: "PRI",
    PY: "PRY",
    SV: "SLV",
    US: "USA",
    UY: "URY",
    VE: "VEN",
  };

  return alpha2ToAlpha3[normalized] ?? normalized;
}

function getString(payload: DiditPayload, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" ? value : null;
}

function normalizeDiditStatus(status: string | null): IdentityDecision["status"] {
  const normalized = status?.toLowerCase().replace(/[_-]/g, " ").trim();
  if (normalized === "approved") {
    return "approved";
  }

  if (normalized === "declined") {
    return "declined";
  }

  if (
    normalized === "expired" ||
    normalized === "abandoned" ||
    normalized === "kyc expired"
  ) {
    return "expired";
  }

  return "pending";
}

function normalizeDiditDecision(payload: DiditPayload): IdentityDecision {
  const decision =
    payload.decision && typeof payload.decision === "object"
      ? (payload.decision as DiditPayload)
      : payload;
  const status = getString(payload, "status") ?? getString(decision, "status");

  return {
    biometricSource: {
      face_matches: decision.face_matches,
      id_verifications: decision.id_verifications,
      liveness_checks: decision.liveness_checks,
      session_id: getString(payload, "session_id") ?? getString(decision, "session_id"),
      status,
    },
    biometricScore: null,
    matchedIdentityReference: null,
    personId:
      getString(payload, "user_id") ??
      getString(decision, "user_id") ??
      getString(payload, "session_id") ??
      getString(decision, "session_id"),
    provider: "didit",
    providerStatus: status,
    raw: payload,
    reason:
      getString(payload, "reason") ??
      getString(decision, "reason") ??
      getString(payload, "decline_reason") ??
      getString(decision, "decline_reason"),
    sessionId: getString(payload, "session_id") ?? getString(decision, "session_id"),
    status: normalizeDiditStatus(status),
  };
}

async function parseDiditResponse<T>(response: Response): Promise<T> {
  const rawBody = await response.text();
  const parsedBody = rawBody ? (JSON.parse(rawBody) as T) : ({} as T);

  if (!response.ok) {
    throw new Error(
      `Didit API respondio ${response.status} ${response.statusText}: ${rawBody}`,
    );
  }

  return parsedBody;
}

export const diditAdapter: IdentityVerificationAdapter = {
  assertWebhookHmac(rawBody, headers) {
    const secret = getDiditWebhookSecret();
    const timestamp = getHeader(headers, "x-timestamp");
    assertRecentTimestamp(timestamp);

    const signatureV2 = getHeader(headers, "x-signature-v2");
    const signatureSimple = getHeader(headers, "x-signature-simple");
    const signature = getHeader(headers, "x-signature");
    const parsedPayload = JSON.parse(rawBody) as DiditPayload;

    const verified =
      timingSafeHexEqual(sign(stableJson(parsedPayload), secret), signatureV2) ||
      timingSafeHexEqual(
        sign(
          [
            getString(parsedPayload, "timestamp") ?? "",
            getString(parsedPayload, "session_id") ?? "",
            getString(parsedPayload, "status") ?? "",
            getString(parsedPayload, "webhook_type") ?? "",
          ].join(":"),
          secret,
        ),
        signatureSimple,
      ) ||
      timingSafeHexEqual(sign(rawBody, secret), signature);

    if (!verified) {
      throw new Error("La firma HMAC del webhook de Didit es invalida");
    }
  },
  createSandboxSession(): IdentitySession {
    const sessionId = `sandbox-${randomUUID()}`;
    return {
      id: sessionId,
      provider: "didit",
      token: `sandbox-token-${sessionId}`,
      url: `https://verify.didit.me/session/${sessionId}`,
    };
  },
  async createSession(request: IdentitySessionRequest): Promise<IdentitySession> {
    const { apiKey, baseUrl, workflowId } = getDiditConfig();
    const response = await fetch(`${baseUrl}/v3/session/`, {
      body: JSON.stringify({
        callback: request.callbackUrl,
        callback_method: "both",
        expected_details: {
          date_of_birth: request.person?.dateOfBirth,
          expected_document_types: request.document
            ? [mapDocumentType(request.document.type)]
            : undefined,
          first_name: request.person?.firstName,
          id_country: mapCountryToAlpha3(request.document?.country),
          last_name: request.person?.lastName,
        },
        language: "es",
        vendor_data: request.vendorData,
        workflow_id: workflowId,
      }),
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      method: "POST",
    });
    const session = await parseDiditResponse<DiditSessionResponse>(response);

    if (!session.session_id) {
      throw new Error("Didit no devolvio un identificador de sesion valido");
    }

    return {
      id: session.session_id,
      provider: "didit",
      token: session.session_token ?? null,
      url: session.verification_url ?? session.url ?? null,
    };
  },
  getCallbackUrl() {
    const explicitWebhookUrl = process.env.DIDIT_WEBHOOK_URL?.trim();
    if (explicitWebhookUrl) {
      return explicitWebhookUrl;
    }

    const baseUrl = process.env.NEXTAUTH_URL?.trim()?.replace(/\/+$/, "");
    if (!baseUrl) {
      throw new Error("Falta DIDIT_WEBHOOK_URL o NEXTAUTH_URL para construir el callback");
    }

    return `${baseUrl}/api/didit/webhook`;
  },
  async getDecision(sessionId: string): Promise<IdentityDecision> {
    const { apiKey, baseUrl } = getDiditConfig();
    const response = await fetch(`${baseUrl}/v3/session/${sessionId}/decision/`, {
      headers: {
        Accept: "application/json",
        "x-api-key": apiKey,
      },
      method: "GET",
    });

    return normalizeDiditDecision(await parseDiditResponse<DiditPayload>(response));
  },
  isConfigError(error: unknown): boolean {
    const msg = error instanceof Error ? error.message : String(error);
    return (
      msg.includes("Falta DIDIT_API_KEY") ||
      msg.includes("Falta DIDIT_WORKFLOW_ID") ||
      msg.includes("Falta DIDIT_WEBHOOK_SECRET") ||
      msg.includes("Falta DIDIT_WEBHOOK_URL") ||
      msg.includes("Falta NEXTAUTH_URL") ||
      msg.includes("respondio 401") ||
      msg.includes("respondio 403")
    );
  },
  isSandboxMode() {
    return process.env.DIDIT_SANDBOX_MODE?.trim().toLowerCase() === "true";
  },
  parseWebhook(rawBody: string): IdentityWebhookPayload {
    const payload = JSON.parse(rawBody) as DiditPayload;
    const sessionId = getString(payload, "session_id");
    if (!sessionId) {
      throw new Error("El webhook no incluye session_id");
    }

    return {
      decision: normalizeDiditDecision(payload),
      raw: payload,
      sessionId,
      status: getString(payload, "status"),
    };
  },
  provider: "didit",
  sandboxBiometricHash(seed: string): string {
    return createHash("sha256").update(`didit-sandbox:${seed}`, "utf8").digest("hex");
  },
};
