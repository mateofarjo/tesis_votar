/**
 * Pruebas unitarias del modulo criptografico **del cliente**.
 *
 * Hasta ahora este modulo se ejercitaba unicamente de forma indirecta, a traves
 * de la prueba de integracion del ciclo completo. Eso deja sin cubrir
 * exactamente los casos que no aparecen en una ejecucion feliz: aritmetica
 * modular con valores de borde, factores de cegado no coprimos, firmas que no
 * validan localmente y tokens mal formados.
 *
 * El contraste mas importante es el ultimo: se comprueba que el digesto que
 * calcula el cliente coincide byte a byte con el que calcula el servidor. Si
 * ambas implementaciones divergieran, ninguna credencial seria aceptada por el
 * contrato, y la prueba de integracion solo lo revelaria como un fallo opaco.
 */
import { createHash, webcrypto } from "node:crypto";

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

import {
  VOTE_CREDENTIAL_DOMAIN,
  bytesToHex,
  createBlindingFactor,
  createVoteToken,
  decimalToHex,
  getCredentialMessageHash,
  greatestCommonDivisor,
  hexToBytes,
  modInverse,
  modPow
} from "./blindVoteToken";

describe("modulo criptografico del cliente", () => {
  describe("token de voto", () => {
    it("genera 32 bytes hexadecimales canonicos", () => {
      const token = createVoteToken();
      expect(token).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it("no repite tokens entre invocaciones", () => {
      const tokens = new Set(Array.from({ length: 200 }, () => createVoteToken()));
      expect(tokens.size).toBe(200);
    });

    it("rechaza longitudes distintas de 32 bytes", () => {
      expect(() => hexToBytes(`0x${"11".repeat(31)}`)).toThrow();
      expect(() => hexToBytes(`0x${"11".repeat(33)}`)).toThrow();
      expect(() => hexToBytes("0x")).toThrow();
      expect(() => hexToBytes("no es hexadecimal")).toThrow();
    });

    it("acepta el token con y sin prefijo 0x", () => {
      const sinPrefijo = "ab".repeat(32);
      expect(bytesToHex(hexToBytes(sinPrefijo))).toBe(sinPrefijo);
      expect(bytesToHex(hexToBytes(`0x${sinPrefijo}`))).toBe(sinPrefijo);
    });
  });

  describe("separacion de dominio", () => {
    it("coincide con el digesto que calcula el servidor", async () => {
      const token = createVoteToken();
      const enElCliente = await getCredentialMessageHash(token);
      const enElServidor = createHash("sha256")
        .update(VOTE_CREDENTIAL_DOMAIN, "utf8")
        .update(Buffer.from(token.slice(2), "hex"))
        .digest("hex");
      expect(enElCliente).toBe(enElServidor);
    });

    it("no coincide con SHA-256 del token sin el prefijo de dominio", async () => {
      const token = createVoteToken();
      const conDominio = await getCredentialMessageHash(token);
      const sinDominio = createHash("sha256")
        .update(Buffer.from(token.slice(2), "hex"))
        .digest("hex");
      expect(conDominio).not.toBe(sinDominio);
    });

    it("es determinista para un mismo token", async () => {
      const token = createVoteToken();
      expect(await getCredentialMessageHash(token)).toBe(await getCredentialMessageHash(token));
    });
  });

  describe("aritmetica modular", () => {
    it("modPow coincide con la exponenciacion directa en casos chicos", () => {
      expect(modPow(2n, 10n, 1000n)).toBe(24n);
      expect(modPow(7n, 0n, 13n)).toBe(1n);
      expect(modPow(0n, 5n, 13n)).toBe(0n);
      expect(modPow(5n, 1n, 5n)).toBe(0n);
    });

    it("modInverse satisface a * a^-1 = 1 (mod n)", () => {
      const n = 3233n;
      for (const a of [17n, 413n, 2753n]) {
        expect((a * modInverse(a, n)) % n).toBe(1n);
      }
    });

    it("modInverse falla cuando el valor no es coprimo con el modulo", () => {
      expect(() => modInverse(4n, 8n)).toThrow();
    });

    it("greatestCommonDivisor trata los negativos por valor absoluto", () => {
      expect(greatestCommonDivisor(-12n, 18n)).toBe(6n);
      expect(greatestCommonDivisor(12n, -18n)).toBe(6n);
      expect(greatestCommonDivisor(0n, 7n)).toBe(7n);
    });

    it("decimalToHex rellena a la izquierda hasta el tamano del modulo", () => {
      expect(decimalToHex(255n, 2)).toBe("0x00ff");
      expect(decimalToHex(1n, 256)).toBe(`0x${"00".repeat(255)}01`);
      expect(decimalToHex(1n, 256).length).toBe(2 + 512);
    });
  });

  describe("factor de cegado", () => {
    it("siempre resulta coprimo con el modulo", () => {
      // Modulo compuesto con factores chicos: maximiza la probabilidad de que
      // un candidato no sea coprimo, de modo que el rechazo se ejercite.
      const modulo = 3233n;
      for (let i = 0; i < 50; i += 1) {
        const r = createBlindingFactor(modulo);
        expect(greatestCommonDivisor(r, modulo)).toBe(1n);
        expect(r > 1n && r < modulo).toBe(true);
      }
    });

    it("es invertible, que es lo que el descegado necesita", () => {
      const modulo = 3233n;
      const r = createBlindingFactor(modulo);
      expect((r * modInverse(r, modulo)) % modulo).toBe(1n);
    });
  });

  describe("ciclo de cegado y descegado sobre una clave chica", () => {
    // Clave de juguete (n = 3233, e = 17, d = 413). Sirve para verificar el
    // algebra del protocolo, no su seguridad.
    const n = 3233n;
    const e = 17n;
    const d = 413n;

    it("recupera una firma valida sobre el mensaje original", () => {
      const mensaje = 65n;
      const r = createBlindingFactor(n);
      const cegado = (mensaje * modPow(r, e, n)) % n;
      const firmadoCegado = modPow(cegado, d, n);
      const firma = (firmadoCegado * modInverse(r, n)) % n;
      expect(modPow(firma, e, n)).toBe(mensaje);
    });

    it("el valor cegado no revela el mensaje", () => {
      const mensaje = 65n;
      const cegados = new Set(
        Array.from({ length: 30 }, () => ((mensaje * modPow(createBlindingFactor(n), e, n)) % n).toString())
      );
      // Distintos factores producen distintos valores cegados para el mismo
      // mensaje: es lo que impide al firmante reconocerlo.
      expect(cegados.size).toBeGreaterThan(1);
    });

    it("una firma sobre otro mensaje no valida", () => {
      const r = createBlindingFactor(n);
      const cegado = (65n * modPow(r, e, n)) % n;
      const firma = (modPow(cegado, d, n) * modInverse(r, n)) % n;
      expect(modPow(firma, e, n)).not.toBe(66n);
    });
  });
});
