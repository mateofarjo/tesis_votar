import { createHash, timingSafeEqual } from "node:crypto";

export type JsonLike =
  | null
  | boolean
  | number
  | string
  | Date
  | Uint8Array
  | JsonLike[]
  | { [key: string]: JsonLike | undefined };

function normalizeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error("Los vectores biometricos no admiten numeros no finitos");
  }

  if (Object.is(value, -0)) {
    return "0";
  }

  const normalized = value.toFixed(12).replace(/\.?0+$/, "");
  return normalized === "" ? "0" : normalized;
}

function canonicalizeBiometricPayload(input: JsonLike): string {
  if (input === null) {
    return "null";
  }

  if (input instanceof Date) {
    return JSON.stringify(input.toISOString());
  }

  if (input instanceof Uint8Array) {
    return JSON.stringify(Buffer.from(input).toString("base64"));
  }

  if (Array.isArray(input)) {
    return `[${input.map((item) => canonicalizeBiometricPayload(item)).join(",")}]`;
  }

  switch (typeof input) {
    case "boolean":
      return input ? "true" : "false";
    case "number":
      return JSON.stringify(normalizeNumber(input));
    case "string":
      return JSON.stringify(input);
    case "object": {
      const entries = Object.entries(input)
        .filter(([, value]) => value !== undefined)
        .sort(([left], [right]) => left.localeCompare(right));

      const serialized = entries.map(
        ([key, value]) => `${JSON.stringify(key)}:${canonicalizeBiometricPayload(value as JsonLike)}`
      );

      return `{${serialized.join(",")}}`;
    }
    default:
      throw new Error("Tipo de dato biometrico no soportado");
  }
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function normalizeHex(hash: string): Buffer {
  const normalized = hash.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error("El hash debe ser un SHA-256 hexadecimal de 64 caracteres");
  }

  return Buffer.from(normalized, "hex");
}

export function hashBiometricVector(vector: JsonLike): string {
  return sha256Hex(canonicalizeBiometricPayload(vector));
}

export function hashDni(dni: string): string {
  const normalized = dni.replace(/\D/g, "");
  if (!normalized) {
    throw new Error("El DNI debe contener al menos un digito");
  }

  return sha256Hex(normalized);
}

export function hashIpAddress(ipAddress: string): string {
  const normalized = ipAddress.trim();
  if (!normalized) {
    throw new Error("La IP no puede estar vacia");
  }

  return sha256Hex(normalized);
}

export function hashUserAgent(userAgent: string): string {
  const normalized = userAgent.trim();
  if (!normalized) {
    throw new Error("El user-agent no puede estar vacio");
  }

  return sha256Hex(normalized);
}

export function compareSha256Hashes(leftHash: string, rightHash: string): boolean {
  const left = normalizeHex(leftHash);
  const right = normalizeHex(rightHash);

  return left.length === right.length && timingSafeEqual(left, right);
}
