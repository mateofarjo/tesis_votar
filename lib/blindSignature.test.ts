/// <reference types="jest" />

import BlindSignature = require("blind-signatures");

import {
  generateKeyPair,
  getBlindSignaturePublicKey,
  signBlindToken,
  verifyUnblindedToken
} from "./blindSignature";

describe("blindSignature", () => {
  const originalPrivateKey = process.env.RSA_PRIVATE_KEY_PEM;
  const originalPublicKey = process.env.RSA_PUBLIC_KEY_PEM;
  let consoleSpy: jest.SpyInstance<void, [message?: unknown, ...optionalParams: unknown[]]>;

  beforeEach(() => {
    delete process.env.RSA_PRIVATE_KEY_PEM;
    delete process.env.RSA_PUBLIC_KEY_PEM;
    consoleSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (originalPrivateKey === undefined) {
      delete process.env.RSA_PRIVATE_KEY_PEM;
    } else {
      process.env.RSA_PRIVATE_KEY_PEM = originalPrivateKey;
    }

    if (originalPublicKey === undefined) {
      delete process.env.RSA_PUBLIC_KEY_PEM;
    } else {
      process.env.RSA_PUBLIC_KEY_PEM = originalPublicKey;
    }

    consoleSpy.mockRestore();
  });

  it("genera un par RSA de 2048 bits y lo imprime para .env", () => {
    const keys = generateKeyPair();

    expect(keys.privateKey).toContain("BEGIN RSA PRIVATE KEY");
    expect(keys.publicKey).toContain("BEGIN PUBLIC KEY");
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("RSA_PRIVATE_KEY_PEM="));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("RSA_PUBLIC_KEY_PEM="));

    process.env.RSA_PUBLIC_KEY_PEM = keys.publicKey;
    expect(getBlindSignaturePublicKey().modulusLengthBytes).toBe(256);
  });

  it("firma un mensaje cegado y verifica la firma descegada", () => {
    const keys = generateKeyPair();
    process.env.RSA_PRIVATE_KEY_PEM = keys.privateKey;
    process.env.RSA_PUBLIC_KEY_PEM = keys.publicKey;

    const message = "token-de-voto-test";
    const publicKey = getBlindSignaturePublicKey();
    const { blinded, r } = BlindSignature.blind({
      E: publicKey.E,
      N: publicKey.N,
      message
    });

    const signedBlindToken = signBlindToken(blinded.toString());
    const unblindedSignature = BlindSignature.unblind({
      N: publicKey.N,
      r: r.toString(),
      signed: signedBlindToken
    }).toString();

    expect(verifyUnblindedToken(message, unblindedSignature)).toBe(true);
    expect(verifyUnblindedToken("mensaje-adulterado", unblindedSignature)).toBe(false);
  });
});
