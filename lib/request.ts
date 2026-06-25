import { createHash } from "node:crypto";

type HeaderContainer = Headers | { get(name: string): string | null };

export function normalizeString(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function getHeaderValue(headers: HeaderContainer, name: string): string | undefined {
  return normalizeString(headers.get(name) ?? headers.get(name.toLowerCase()) ?? undefined);
}

export function getClientIp(headers: HeaderContainer): string | undefined {
  const forwardedFor = getHeaderValue(headers, "x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim();
  }

  return getHeaderValue(headers, "x-real-ip");
}

export function getUserAgent(headers: HeaderContainer): string | undefined {
  return getHeaderValue(headers, "user-agent");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
