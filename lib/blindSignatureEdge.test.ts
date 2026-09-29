/// <reference types="jest" />
/**
 * Casos limite del modulo criptografico del servidor.
 *
 * La suite existente cubre el camino feliz: generar un par de claves y firmar un
 * valor cegado que luego valida. Aqui se ejercitan las entradas que un
 * adversario elegiria y que una ejecucion normal nunca produce: tokens mal
 * formados, firmas de longitud incorrecta, valores fuera del rango del modulo y
 * credenciales que simplemente no llevan la firma de la autoridad.
 */
import { createHash, generateKeyPairSync } from "node:crypto";

import {
  decodeSignedVoteTokenFromContract,
  encodeSignedVoteTokenForContract,
  esCredencialValidaFueraDeCadena,
  generateVoteToken,
  getBlindSignaturePublicKey,
  getVoteTokenDigestHex
} from "./blindSignature";

const VOTE_CREDENTIAL_DOMAIN = "VOT.AR/VOTE-CREDENTIAL/v1";

function instalarClaveDePrueba(): { d: bigint; e: bigint; n: bigint } {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { format: "pem", type: "pkcs1" },
    publicKeyEncoding: { format: "pem", type: "pkcs1" }
  });
  process.env.RSA_PRIVATE_KEY_PEM = privateKey;
  process.env.RSA_PUBLIC_KEY_PEM = publicKey;

  const { exponentHex, modulusHex } = getBlindSignaturePublicKey();
  const jwk = require("node:crypto").createPrivateKey(privateKey).export({ format: "jwk" });
  return {
    d: BigInt(`0x${Buffer.from(jwk.d as string, "base64url").toString("hex")}`),
    e: BigInt(exponentHex.startsWith("0x") ? exponentHex : `0x${exponentHex}`),
    n: BigInt(modulusHex.startsWith("0x") ? modulusHex : `0x${modulusHex}`)
  };
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let resultado = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) resultado = (resultado * b) % modulus;
    e >>= 1n;
    b = (b * b) % modulus;
  }
  return resultado;
}

const hex = (v: bigint, bytes: number) => `0x${v.toString(16).padStart(bytes * 2, "0")}`;

describe("casos limite del modulo criptografico del servidor", () => {
  const privadaOriginal = process.env.RSA_PRIVATE_KEY_PEM;
  const publicaOriginal = process.env.RSA_PUBLIC_KEY_PEM;
  let clave: { d: bigint; e: bigint; n: bigint };

  beforeAll(() => {
    clave = instalarClaveDePrueba();
  });

  afterAll(() => {
    if (privadaOriginal) process.env.RSA_PRIVATE_KEY_PEM = privadaOriginal;
    else delete process.env.RSA_PRIVATE_KEY_PEM;
    if (publicaOriginal) process.env.RSA_PUBLIC_KEY_PEM = publicaOriginal;
    else delete process.env.RSA_PUBLIC_KEY_PEM;
  });

  const credencialValida = () => {
    const token = generateVoteToken();
    const mensaje = BigInt(getVoteTokenDigestHex(token));
    return { firma: hex(modPow(mensaje, clave.d, clave.n), 256), token };
  };

  describe("digesto separado por dominio", () => {
    it("exige un token hexadecimal canonico de 32 bytes", () => {
      expect(() => getVoteTokenDigestHex(`0x${"11".repeat(31)}`)).toThrow();
      expect(() => getVoteTokenDigestHex(`0x${"11".repeat(33)}`)).toThrow();
      expect(() => getVoteTokenDigestHex("0x")).toThrow();
      expect(() => getVoteTokenDigestHex("nada")).toThrow();
    });

    it("incorpora efectivamente el prefijo de dominio", () => {
      const token = generateVoteToken();
      const sinDominio = `0x${createHash("sha256").update(Buffer.from(token.slice(2), "hex")).digest("hex")}`;
      expect(getVoteTokenDigestHex(token)).not.toBe(sinDominio);
      expect(getVoteTokenDigestHex(token)).toBe(
        `0x${createHash("sha256")
          .update(VOTE_CREDENTIAL_DOMAIN, "utf8")
          .update(Buffer.from(token.slice(2), "hex"))
          .digest("hex")}`
      );
    });

    it("es insensible a mayusculas en el token", () => {
      const token = generateVoteToken();
      expect(getVoteTokenDigestHex(token.toUpperCase().replace("0X", "0x"))).toBe(
        getVoteTokenDigestHex(token)
      );
    });
  });

  describe("verificacion fuera de cadena", () => {
    it("acepta una credencial legitima", () => {
      const { firma, token } = credencialValida();
      expect(esCredencialValidaFueraDeCadena(token, firma)).toBe(true);
    });

    it("rechaza una firma valida presentada con otro token", () => {
      const { firma } = credencialValida();
      expect(esCredencialValidaFueraDeCadena(generateVoteToken(), firma)).toBe(false);
    });

    it("rechaza el token y la firma de longitud incorrecta", () => {
      const { firma, token } = credencialValida();
      expect(esCredencialValidaFueraDeCadena(`0x${"11".repeat(31)}`, firma)).toBe(false);
      expect(esCredencialValidaFueraDeCadena(`0x${"11".repeat(33)}`, firma)).toBe(false);
      expect(esCredencialValidaFueraDeCadena(token, `0x${"22".repeat(255)}`)).toBe(false);
      expect(esCredencialValidaFueraDeCadena(token, `0x${"22".repeat(257)}`)).toBe(false);
    });

    it("rechaza firma cero y firma fuera del rango del modulo", () => {
      const { firma, token } = credencialValida();
      expect(esCredencialValidaFueraDeCadena(token, hex(0n, 256))).toBe(false);
      expect(esCredencialValidaFueraDeCadena(token, hex(clave.n, 256))).toBe(false);
      // s + n es congruente con s, pero se rechaza por estar fuera de [1, n).
      expect(esCredencialValidaFueraDeCadena(token, hex(BigInt(firma) + clave.n, 256))).toBe(false);
    });

    it("rechaza una falsificacion multiplicativa", () => {
      const { firma, token } = credencialValida();
      const cuadrado = (BigInt(firma) * BigInt(firma)) % clave.n;
      expect(esCredencialValidaFueraDeCadena(token, hex(cuadrado, 256))).toBe(false);
    });

    it("rechaza una firma calculada sin separacion de dominio", () => {
      const token = generateVoteToken();
      const sinDominio = BigInt(
        `0x${createHash("sha256").update(Buffer.from(token.slice(2), "hex")).digest("hex")}`
      );
      expect(
        esCredencialValidaFueraDeCadena(token, hex(modPow(sinDominio, clave.d, clave.n), 256))
      ).toBe(false);
    });

    it("no lanza ante entradas basura", () => {
      for (const basura of ["", "0x", "no-hex", "0xzz", "0"]) {
        expect(esCredencialValidaFueraDeCadena(basura, basura)).toBe(false);
      }
    });
  });

  describe("codificacion de la credencial para el contrato", () => {
    it("el ciclo de codificar y decodificar preserva ambos componentes", () => {
      const { firma, token } = credencialValida();
      const decodificado = decodeSignedVoteTokenFromContract(
        encodeSignedVoteTokenForContract(token, firma)
      );
      expect(decodificado.tokenDigestHex).toBe(token);
      expect(decodificado.signatureHex).toBe(firma);
    });

    it("falla ante una carga que no es ABI valida", () => {
      expect(() => decodeSignedVoteTokenFromContract("0x1234")).toThrow();
    });
  });

  describe("generacion de tokens", () => {
    it("produce 32 bytes canonicos y sin repeticiones", () => {
      const tokens = new Set(Array.from({ length: 200 }, () => generateVoteToken()));
      expect(tokens.size).toBe(200);
      for (const t of tokens) expect(t).toMatch(/^0x[0-9a-f]{64}$/);
    });
  });
});
