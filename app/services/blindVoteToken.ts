import { ethers } from "ethers";

import type { VoteTokenResponse } from "./election";

const abiCoder = ethers.AbiCoder.defaultAbiCoder();
const STORAGE_KEY = "votar.anonymousVoteCredential.v2";
export const VOTE_CREDENTIAL_DOMAIN = "VOT.AR/VOTE-CREDENTIAL/v2";

export type BlindSignaturePublicKeyResponse = {
  E: string;
  N: string;
  modulusLengthBytes: number;
};

export type SignedBlindVoteTokenResponse = {
  expiresAt: string;
  signedBlindedToken: string;
};

type StoredVoteCredential = VoteTokenResponse;

type PreparedAnonymousVoteCredential = {
  blindedToken: string;
  unblindSignedToken(response: SignedBlindVoteTokenResponse): VoteTokenResponse;
};

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage;
}

export function getStoredVoteCredential(): VoteTokenResponse | null {
  const storage = getStorage();
  if (!storage) return null;

  const rawValue = storage.getItem(STORAGE_KEY);
  if (!rawValue) return null;

  try {
    const credential = JSON.parse(rawValue) as StoredVoteCredential;
    if (
      typeof credential.expiresAt === "string" &&
      typeof credential.tokenDigestHex === "string" &&
      typeof credential.tokenFirmado === "string"
    ) {
      return credential;
    }
  } catch {
    // Fall through and discard malformed local state.
  }

  storage.removeItem(STORAGE_KEY);
  return null;
}

export function clearStoredVoteCredential(): void {
  getStorage()?.removeItem(STORAGE_KEY);
}

function storeVoteCredential(credential: VoteTokenResponse): void {
  getStorage()?.setItem(STORAGE_KEY, JSON.stringify(credential));
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/i.test(normalized)) {
    throw new Error("El token de voto debe tener exactamente 32 bytes");
  }

  return Uint8Array.from(
    normalized.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)),
  );
}

export function createVoteToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${bytesToHex(bytes)}`;
}

/**
 * Mensaje sometido a firma ciega: SHA-256(dominio || token || candidatoId).
 *
 * El candidato forma parte del mensaje, de modo que la credencial queda
 * comprometida con la opcion elegida desde el momento en que se emite. Esto
 * obliga a elegir antes de pedir la credencial, y a cambio impide que quien
 * retransmite la transaccion altere el voto.
 */
export async function getCredentialMessageHash(
  token: string,
  candidatoId: number,
): Promise<string> {
  if (!Number.isInteger(candidatoId) || candidatoId < 0 || candidatoId > 255) {
    throw new Error("El identificador de candidato debe ser un entero de un byte");
  }
  const domain = new TextEncoder().encode(VOTE_CREDENTIAL_DOMAIN);
  const tokenBytes = hexToBytes(token);
  const input = new Uint8Array(domain.length + tokenBytes.length + 1);
  input.set(domain);
  input.set(tokenBytes, domain.length);
  input[domain.length + tokenBytes.length] = candidatoId;
  const digest = await crypto.subtle.digest("SHA-256", input);
  return bytesToHex(new Uint8Array(digest));
}

export function randomBigIntBelow(maxExclusive: bigint): bigint {
  const byteLength = Math.ceil(maxExclusive.toString(16).length / 2);
  const randomBytes = new Uint8Array(byteLength);

  while (true) {
    crypto.getRandomValues(randomBytes);
    const candidate = BigInt(`0x${bytesToHex(randomBytes)}`);
    if (candidate > 1n && candidate < maxExclusive) {
      return candidate;
    }
  }
}

export function greatestCommonDivisor(a: bigint, b: bigint): bigint {
  let left = a < 0n ? -a : a;
  let right = b < 0n ? -b : b;

  while (right !== 0n) {
    const next = left % right;
    left = right;
    right = next;
  }

  return left;
}

export function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  if (modulus === 1n) return 0n;

  let result = 1n;
  let currentBase = base % modulus;
  let currentExponent = exponent;

  while (currentExponent > 0n) {
    if (currentExponent % 2n === 1n) {
      result = (result * currentBase) % modulus;
    }

    currentExponent /= 2n;
    currentBase = (currentBase * currentBase) % modulus;
  }

  return result;
}

export function modInverse(value: bigint, modulus: bigint): bigint {
  let oldR = value;
  let r = modulus;
  let oldS = 1n;
  let s = 0n;

  while (r !== 0n) {
    const quotient = oldR / r;
    [oldR, r] = [r, oldR - quotient * r];
    [oldS, s] = [s, oldS - quotient * s];
  }

  if (oldR !== 1n) {
    throw new Error("El factor de cegado no es invertible");
  }

  return ((oldS % modulus) + modulus) % modulus;
}

export function decimalToHex(decimalValue: bigint, lengthBytes: number): string {
  const hex = decimalValue.toString(16).padStart(lengthBytes * 2, "0");
  return `0x${hex}`;
}

export function createBlindingFactor(modulus: bigint): bigint {
  while (true) {
    const candidate = randomBigIntBelow(modulus);
    if (greatestCommonDivisor(candidate, modulus) === 1n) {
      return candidate;
    }
  }
}

export async function createAnonymousVoteCredential(
  publicKey: BlindSignaturePublicKeyResponse,
  candidatoId: number,
): Promise<PreparedAnonymousVoteCredential> {
  const token = createVoteToken();
  const modulus = BigInt(publicKey.N);
  const exponent = BigInt(publicKey.E);
  const messageHash = BigInt(`0x${await getCredentialMessageHash(token, candidatoId)}`);
  const blindingFactor = createBlindingFactor(modulus);
  const blindedToken =
    (messageHash * modPow(blindingFactor, exponent, modulus)) % modulus;

  return {
    blindedToken: blindedToken.toString(10),
    unblindSignedToken(response) {
      const signedBlindedToken = BigInt(response.signedBlindedToken);
      const signature =
        (signedBlindedToken * modInverse(blindingFactor, modulus)) % modulus;
      const recoveredHash = modPow(signature, exponent, modulus);

      if (recoveredHash !== messageHash) {
        throw new Error("La firma ciega RSA no pudo validarse localmente");
      }

      // El contrato recibe el secreto aleatorio de 32 bytes, no el hash que se
      // firma. El hash separado por dominio se reconstruye on-chain.
      const tokenDigestHex = token;
      const signatureHex = decimalToHex(signature, publicKey.modulusLengthBytes);
      const credential = {
        candidatoId,
        expiresAt: response.expiresAt,
        tokenDigestHex,
        tokenFirmado: abiCoder.encode(
          ["bytes", "bytes"],
          [tokenDigestHex, signatureHex],
        ),
      };

      storeVoteCredential(credential);
      return credential;
    },
  };
}
