import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

type HeadersLike =
  | Headers
  | Record<string, string | string[] | undefined>
  | undefined;

export type VeriffSessionRequest = {
  verification: {
    callback?: string;
    document?: {
      country?: string;
      number?: string;
      type?: string;
    };
    endUserId?: string;
    person?: {
      dateOfBirth?: string;
      firstName?: string;
      idNumber?: string;
      lastName?: string;
    };
    timestamp?: string;
    vendorData?: string;
  };
};

export type VeriffSessionResponse = {
  status: "success" | "fail";
  verification: {
    endUserId?: string | null;
    id: string;
    sessionToken?: string;
    status?: string | null;
    url?: string;
    vendorData?: string | null;
  } | null;
};

export type VeriffDecisionStatus =
  | "approved"
  | "declined"
  | "resubmission_requested"
  | "review"
  | "expired"
  | "abandoned";

export type VeriffDecisionPayload = {
  status: "success" | "fail";
  verification: {
    additionalVerifiedData?: Record<string, unknown>;
    attemptId?: string;
    biometricAuthentication?: {
      details?: Record<string, unknown>;
      matchedSessionEndUserId?: string | null;
      matchedSessionId?: string | null;
      matchedSessionVendorData?: string | null;
    };
    code?: number;
    endUserId?: string | null;
    id?: string;
    reason?: string | null;
    reasonCode?: string | null;
    status?: VeriffDecisionStatus;
    vendorData?: string | null;
    [key: string]: unknown;
  } | null;
};

const DEFAULT_VERIFF_BASE_URL = "https://stationapi.veriff.com";

function getVeriffConfig() {
  const apiKey = process.env.VERIFF_API_KEY?.trim();
  const secretKey = process.env.VERIFF_SECRET_KEY?.trim();
  const baseUrl = process.env.VERIFF_BASE_URL?.trim() || DEFAULT_VERIFF_BASE_URL;

  if (!apiKey) {
    throw new Error("Falta VERIFF_API_KEY en el entorno");
  }

  if (!secretKey) {
    throw new Error("Falta VERIFF_SECRET_KEY en el entorno");
  }

  return {
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    secretKey
  };
}

function serializeRawBody(body: Buffer | string): Buffer {
  return typeof body === "string" ? Buffer.from(body, "utf8") : body;
}

function signVeriffPayload(payload: Buffer | string): string {
  const { secretKey } = getVeriffConfig();
  return createHmac("sha256", secretKey).update(serializeRawBody(payload)).digest("hex");
}

function normalizeSignature(signature: string): string {
  return signature.trim().toLowerCase().replace(/^sha256=/, "");
}

function readHeaderValue(headers: HeadersLike, headerName: string): string | undefined {
  if (!headers) {
    return undefined;
  }

  if (headers instanceof Headers) {
    return headers.get(headerName) ?? undefined;
  }

  const directValue = headers[headerName] ?? headers[headerName.toLowerCase()];
  if (Array.isArray(directValue)) {
    return directValue[0];
  }

  return directValue;
}

async function parseVeriffResponse<T>(response: Response): Promise<T> {
  const rawBody = await response.text();
  const parsedBody = rawBody ? (JSON.parse(rawBody) as T) : ({} as T);

  if (!response.ok) {
    throw new Error(
      `Veriff API respondio ${response.status} ${response.statusText}: ${rawBody}`
    );
  }

  return parsedBody;
}

export function getVeriffWebhookSignature(headers: HeadersLike): string | undefined {
  return (
    readHeaderValue(headers, "x-hmac-signature") ??
    readHeaderValue(headers, "vrf-hmac-signature") ??
    readHeaderValue(headers, "x-signature")
  );
}

export function verifyVeriffWebhookHmac(
  rawBody: Buffer | string,
  headersOrSignature: HeadersLike | string | undefined
): boolean {
  const providedSignature =
    typeof headersOrSignature === "string"
      ? headersOrSignature
      : getVeriffWebhookSignature(headersOrSignature);

  if (!providedSignature) {
    return false;
  }

  const expected = Buffer.from(signVeriffPayload(rawBody), "hex");
  const received = Buffer.from(normalizeSignature(providedSignature), "hex");

  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function assertVeriffWebhookHmac(
  rawBody: Buffer | string,
  headersOrSignature: HeadersLike | string | undefined
): void {
  if (!verifyVeriffWebhookHmac(rawBody, headersOrSignature)) {
    throw new Error("La firma HMAC del webhook de Veriff es invalida");
  }
}

export async function createVeriffSession(
  payload: VeriffSessionRequest
): Promise<VeriffSessionResponse> {
  const { apiKey, baseUrl } = getVeriffConfig();
  const body = JSON.stringify(payload);

  const response = await fetch(`${baseUrl}/v1/sessions`, {
    body,
    headers: {
      "Content-Type": "application/json",
      "X-AUTH-CLIENT": apiKey,
      "X-HMAC-SIGNATURE": signVeriffPayload(body)
    },
    method: "POST"
  });

  return parseVeriffResponse<VeriffSessionResponse>(response);
}

export async function getVeriffDecision(
  sessionId: string
): Promise<VeriffDecisionPayload> {
  const { apiKey, baseUrl } = getVeriffConfig();
  const sessionSignature = signVeriffPayload(sessionId);

  const response = await fetch(`${baseUrl}/v1/sessions/${sessionId}/decision`, {
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-AUTH-CLIENT": apiKey,
      "X-HMAC-SIGNATURE": sessionSignature
    },
    method: "GET"
  });

  return parseVeriffResponse<VeriffDecisionPayload>(response);
}

export function isSandboxMode(): boolean {
  return process.env.VERIFF_SANDBOX_MODE?.trim().toLowerCase() === "true";
}

export function getVeriffCallbackUrl(): string {
  const explicitWebhookUrl = process.env.VERIFF_WEBHOOK_URL?.trim();
  if (explicitWebhookUrl) {
    return explicitWebhookUrl;
  }

  const baseUrl = process.env.NEXTAUTH_URL?.trim()?.replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("Falta VERIFF_WEBHOOK_URL o NEXTAUTH_URL para construir el callback");
  }

  return `${baseUrl}/api/veriff/webhook`;
}

export function createVeriffSessionSandbox(): VeriffSessionResponse {
  const sessionId = `sandbox-${randomUUID()}`;
  return {
    status: "success",
    verification: {
      id: sessionId,
      sessionToken: `sandbox-token-${sessionId}`,
      status: "created",
      url: "https://sandbox.veriff.com/v/sandbox"
    }
  };
}

export function sandboxBiometricHash(dniHash: string): string {
  return createHash("sha256").update(`sandbox:${dniHash}`, "utf8").digest("hex");
}

export function isVeriffConfigError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes("Falta VERIFF_API_KEY") ||
    msg.includes("Falta VERIFF_SECRET_KEY") ||
    msg.includes("Falta VERIFF_WEBHOOK_URL") ||
    msg.includes("Falta NEXTAUTH_URL") ||
    msg.includes("respondio 401") ||
    msg.includes("respondio 403")
  );
}

export function isApprovedVeriffDecision(payload: VeriffDecisionPayload): boolean {
  return payload.status === "success" && payload.verification?.status === "approved";
}

export function extractBiometricSourceForHash(payload: VeriffDecisionPayload): unknown {
  const verification = payload.verification;
  if (!verification) {
    throw new Error("La decision de Veriff no contiene un objeto verification");
  }

  if (verification.biometricAuthentication) {
    return verification.biometricAuthentication;
  }

  if (verification.additionalVerifiedData) {
    return verification.additionalVerifiedData;
  }

  throw new Error(
    "La configuracion actual de Veriff no expone un bloque biometrico hasheable en la respuesta"
  );
}
