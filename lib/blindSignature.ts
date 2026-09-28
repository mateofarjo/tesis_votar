import { createHash, createPrivateKey, createPublicKey, randomBytes } from "node:crypto";

import BlindSignature = require("blind-signatures");
import { ethers } from "ethers";
import { BigInteger } from "jsbn";

const RSA_KEY_SIZE_BITS = 2048;
const abiCoder = ethers.AbiCoder.defaultAbiCoder();
const VOTE_CREDENTIAL_DOMAIN = "VOT.AR/VOTE-CREDENTIAL/v1";

type RsaJwk = {
  d?: string;
  e?: string;
  kty?: string;
  n?: string;
};

type BlindableValue = {
  toString(radix?: number): string;
};

type BlindSignaturePrivateKey = {
  keyPair: {
    d: BigInteger;
    e: BigInteger;
    n: BigInteger;
  };
};

export type BlindSignaturePublicKey = {
  E: string;
  N: string;
  exponentHex: string;
  fingerprint: string;
  modulusHex: string;
  modulusLengthBytes: number;
};

export type BlindedVoteToken = {
  blindedToken: string;
  blindingFactor: string;
  token: string;
  tokenDigestHex: string;
};

export type UnblindedVoteSignature = {
  encodedTokenFirmado: string;
  signatureDecimal: string;
  signatureHex: string;
  token: string;
  tokenDigestHex: string;
};

let cachedPrivateKey:
  | {
      key: BlindSignaturePrivateKey;
      pem: string;
    }
  | null = null;

let cachedPublicKey:
  | {
      key: BlindSignaturePublicKey;
      pem: string;
    }
  | null = null;

function normalizePem(rawPem: string): string {
  // Reemplaza \n literales (de .env) y normaliza \r\n de Windows a \n unix
  const replaced = rawPem.replace(/\\n/g, "\n").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (replaced.includes("\n")) {
    return replaced;
  }

  const beginMarkers = [
    "-----BEGIN PUBLIC KEY-----",
    "-----BEGIN PRIVATE KEY-----",
    "-----BEGIN RSA PRIVATE KEY-----"
  ];
  const endMarkers = [
    "-----END PUBLIC KEY-----",
    "-----END PRIVATE KEY-----",
    "-----END RSA PRIVATE KEY-----"
  ];

  const beginMarker = beginMarkers.find((marker) => replaced.includes(marker));
  const endMarker = endMarkers.find((marker) => replaced.includes(marker));
  if (!beginMarker || !endMarker) {
    return replaced;
  }

  const body = replaced
    .replace(beginMarker, "")
    .replace(endMarker, "")
    .replace(/\s+/g, "");
  const wrappedBody = body.match(/.{1,64}/g)?.join("\n") ?? body;

  return `${beginMarker}\n${wrappedBody}\n${endMarker}\n`;
}

function pemForEnv(pem: string): string {
  return pem.trim().replace(/\r?\n/g, "\\n");
}

function readRequiredEnvPem(name: "RSA_PRIVATE_KEY_PEM" | "RSA_PUBLIC_KEY_PEM"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Falta ${name} en el entorno`);
  }

  return normalizePem(value);
}

function base64UrlToBuffer(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (normalized.length % 4)) % 4;

  return Buffer.from(normalized + "=".repeat(padding), "base64");
}

function bytesToDecimal(bytes: Buffer): string {
  if (bytes.length === 0) {
    return "0";
  }

  return BigInt(`0x${bytes.toString("hex")}`).toString(10);
}

function jwkPartToDecimal(value: string): string {
  return bytesToDecimal(base64UrlToBuffer(value));
}

function bytesToHex(bytes: Buffer): string {
  return `0x${bytes.toString("hex") || "00"}`;
}

function decimalToHex(decimalValue: string, lengthBytes?: number): string {
  let hex = BigInt(decimalValue).toString(16);
  if (hex.length % 2 !== 0) {
    hex = `0${hex}`;
  }

  if (lengthBytes) {
    hex = hex.padStart(lengthBytes * 2, "0");
  }

  return `0x${hex}`;
}

function assertRsaPublicJwk(jwk: RsaJwk): asserts jwk is RsaJwk & { e: string; n: string } {
  if (jwk.kty !== "RSA" || !jwk.n || !jwk.e) {
    throw new Error("RSA_PUBLIC_KEY_PEM debe ser una clave publica RSA valida");
  }
}

function assertRsaPrivateJwk(
  jwk: RsaJwk
): asserts jwk is RsaJwk & { d: string; e: string; n: string } {
  if (jwk.kty !== "RSA" || !jwk.n || !jwk.e || !jwk.d) {
    throw new Error("RSA_PRIVATE_KEY_PEM debe ser una clave privada RSA valida");
  }
}

function getPublicKeyFromPem(publicKeyPem: string): BlindSignaturePublicKey {
  const publicJwk = createPublicKey(publicKeyPem).export({ format: "jwk" }) as RsaJwk;
  assertRsaPublicJwk(publicJwk);

  const modulusBuffer = base64UrlToBuffer(publicJwk.n);
  const exponentBuffer = base64UrlToBuffer(publicJwk.e);

  return {
    E: bytesToDecimal(exponentBuffer),
    N: bytesToDecimal(modulusBuffer),
    exponentHex: bytesToHex(exponentBuffer),
    fingerprint: createHash("sha256").update(modulusBuffer).digest("hex"),
    modulusHex: bytesToHex(modulusBuffer),
    modulusLengthBytes: modulusBuffer.length
  };
}

function getPrivateKeyFromPem(privateKeyPem: string): BlindSignaturePrivateKey {
  const privateJwk = createPrivateKey(privateKeyPem).export({ format: "jwk" }) as RsaJwk;
  assertRsaPrivateJwk(privateJwk);

  return {
    keyPair: {
      d: new BigInteger(jwkPartToDecimal(privateJwk.d), 10),
      e: new BigInteger(jwkPartToDecimal(privateJwk.e), 10),
      n: new BigInteger(jwkPartToDecimal(privateJwk.n), 10)
    }
  };
}

function loadPrivateKey(): BlindSignaturePrivateKey {
  const privateKeyPem = readRequiredEnvPem("RSA_PRIVATE_KEY_PEM");
  if (cachedPrivateKey?.pem === privateKeyPem) {
    return cachedPrivateKey.key;
  }

  const key = getPrivateKeyFromPem(privateKeyPem);
  cachedPrivateKey = {
    key,
    pem: privateKeyPem
  };

  return key;
}

export function getBlindSignaturePublicKey(): BlindSignaturePublicKey {
  const publicKeyPem = readRequiredEnvPem("RSA_PUBLIC_KEY_PEM");
  if (cachedPublicKey?.pem === publicKeyPem) {
    return cachedPublicKey.key;
  }

  const key = getPublicKeyFromPem(publicKeyPem);
  cachedPublicKey = {
    key,
    pem: publicKeyPem
  };

  return key;
}

function asDecimalString(value: BlindableValue | string): string {
  return typeof value === "string" ? value : value.toString();
}

export function generateKeyPair(): { privateKey: string; publicKey: string } {
  const key = BlindSignature.keyGeneration({
    b: RSA_KEY_SIZE_BITS
  });

  const privateKey = key.exportKey("private");
  const publicKey = key.exportKey("public");

  console.log(`RSA_PRIVATE_KEY_PEM="${pemForEnv(privateKey)}"`);
  console.log(`RSA_PUBLIC_KEY_PEM="${pemForEnv(publicKey)}"`);

  return {
    privateKey,
    publicKey
  };
}

export function signBlindToken(blindedMessage: string): string {
  const normalizedBlindedMessage = blindedMessage.trim();
  if (!normalizedBlindedMessage) {
    throw new Error("El mensaje cegado no puede estar vacio");
  }

  const signed = BlindSignature.sign({
    blinded: normalizedBlindedMessage,
    key: loadPrivateKey()
  });

  return asDecimalString(signed);
}

export function verifyUnblindedToken(message: string, signature: string): boolean {
  const normalizedMessage = message.trim();
  const normalizedSignature = signature.trim();
  if (!normalizedMessage || !normalizedSignature) {
    return false;
  }

  const publicKey = getBlindSignaturePublicKey();

  try {
    return Boolean(
      BlindSignature.verify({
        E: publicKey.E,
        N: publicKey.N,
        message: normalizedMessage,
        unblinded: normalizedSignature
      })
    );
  } catch {
    return false;
  }
}

export function getVoteTokenDigestHex(token: string): string {
  const normalized = token.trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("El token de voto debe ser hexadecimal canonico de 32 bytes");
  }

  return `0x${createHash("sha256")
    .update(VOTE_CREDENTIAL_DOMAIN, "utf8")
    .update(Buffer.from(normalized.slice(2), "hex"))
    .digest("hex")}`;
}

export function generateVoteToken(): string {
  return `0x${randomBytes(32).toString("hex")}`;
}

function voteTokenMessageDecimal(token: string): string {
  return BigInt(getVoteTokenDigestHex(token)).toString(10);
}

export function blindVoteToken(token: string): BlindedVoteToken {
  const publicKey = getBlindSignaturePublicKey();
  const { blinded, r } = BlindSignature.blind({
    E: publicKey.E,
    N: publicKey.N,
    message: voteTokenMessageDecimal(token)
  });

  return {
    blindedToken: asDecimalString(blinded),
    blindingFactor: asDecimalString(r),
    token,
    // Nombre legado: el valor enviado al contrato es el token canónico; el
    // digest separado por dominio se calcula únicamente para firmar/verificar.
    tokenDigestHex: token
  };
}

export function signBlindedToken(blindedToken: string): string {
  return signBlindToken(blindedToken);
}

export function unblindSignedToken(
  token: string,
  signedBlindedToken: string,
  blindingFactor: string
): UnblindedVoteSignature {
  const publicKey = getBlindSignaturePublicKey();
  const unblinded = BlindSignature.unblind({
    N: publicKey.N,
    r: blindingFactor,
    signed: signedBlindedToken
  });

  const signatureDecimal = asDecimalString(unblinded);
  if (!verifyUnblindedToken(voteTokenMessageDecimal(token), signatureDecimal)) {
    throw new Error("La firma ciega RSA no pudo validarse localmente");
  }

  const signatureHex = decimalToHex(signatureDecimal, publicKey.modulusLengthBytes);
  const tokenDigestHex = token;

  return {
    encodedTokenFirmado: encodeSignedVoteTokenForContract(tokenDigestHex, signatureHex),
    signatureDecimal,
    signatureHex,
    token,
    tokenDigestHex
  };
}

export function issueBlindSignedVoteToken(token = generateVoteToken()): UnblindedVoteSignature {
  const blinded = blindVoteToken(token);
  const blindSignature = signBlindToken(blinded.blindedToken);
  return unblindSignedToken(token, blindSignature, blinded.blindingFactor);
}

export function encodeSignedVoteTokenForContract(
  tokenDigestHex: string,
  signatureHex: string
): string {
  return abiCoder.encode(["bytes", "bytes"], [tokenDigestHex, signatureHex]);
}

export function decodeSignedVoteTokenFromContract(encodedPayload: string): {
  signatureHex: string;
  tokenDigestHex: string;
} {
  const [tokenDigestHex, signatureHex] = abiCoder.decode(
    ["bytes", "bytes"],
    encodedPayload
  ) as unknown as [string, string];

  return { signatureHex, tokenDigestHex };
}

export function exportAuthorityPublicKeyForContract(): string {
  const publicKey = getBlindSignaturePublicKey();
  return abiCoder.encode(
    ["bytes", "bytes"],
    [publicKey.modulusHex, publicKey.exponentHex]
  );
}
