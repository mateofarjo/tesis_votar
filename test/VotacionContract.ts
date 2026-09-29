import { createHash, generateKeyPairSync, createPrivateKey, createPublicKey } from "node:crypto";

import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { VotacionContract__factory, type VotacionContract } from "../typechain-types";

const abiCoder = ethers.AbiCoder.defaultAbiCoder();
const VOTE_CREDENTIAL_DOMAIN = "VOT.AR/VOTE-CREDENTIAL/v1";
type TestRsaKey = { d: bigint; e: bigint; n: bigint };

function base64UrlToBigint(value: string): bigint {
  return BigInt(`0x${Buffer.from(value, "base64url").toString("hex")}`);
}

// Test-only key: generated once per test process, never used by deployment.
const rsaKey: TestRsaKey = (() => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { format: "pem", type: "pkcs1" },
    publicKeyEncoding: { format: "pem", type: "spki" }
  });
  const privateJwk = createPrivateKey(privateKey).export({ format: "jwk" });
  const publicJwk = createPublicKey(publicKey).export({ format: "jwk" });
  if (!privateJwk.d || !publicJwk.e || !publicJwk.n) throw new Error("Fixture RSA invalido");
  return { d: base64UrlToBigint(privateJwk.d), e: base64UrlToBigint(publicJwk.e), n: base64UrlToBigint(publicJwk.n) };
})();

function bigintToBytes(value: bigint, lengthBytes?: number): string {
  let hex = value.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  return `0x${lengthBytes ? hex.padStart(lengthBytes * 2, "0") : hex}`;
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let currentBase = base % modulus;
  while (exponent > 0n) {
    if (exponent % 2n) result = (result * currentBase) % modulus;
    exponent /= 2n;
    currentBase = (currentBase * currentBase) % modulus;
  }
  return result;
}

function credentialMessage(token: string): bigint {
  const input = Buffer.concat([Buffer.from(VOTE_CREDENTIAL_DOMAIN), Buffer.from(token.slice(2), "hex")]);
  return BigInt(`0x${createHash("sha256").update(input).digest("hex")}`);
}

function encodePublicKey(): string {
  return abiCoder.encode(["bytes", "bytes"], [bigintToBytes(rsaKey.n, 256), bigintToBytes(rsaKey.e)]);
}

function buildSignedToken(lastByte: number) {
  const token = `0x${"00".repeat(31)}${lastByte.toString(16).padStart(2, "0")}`;
  const signature = modPow(credentialMessage(token), rsaKey.d, rsaKey.n);
  const signatureHex = bigintToBytes(signature, 256);
  return {
    token,
    signature,
    signatureHex,
    payload: abiCoder.encode(["bytes", "bytes"], [token, signatureHex]),
    tokenHash: ethers.keccak256(token)
  };
}

describe("VotacionContract", function () {
  async function deployFixture() {
    const [autoridad, votante] = await ethers.getSigners();
    const contract: VotacionContract = await new VotacionContract__factory(autoridad).deploy(
      ["Lista A", "Lista B", "Blanco"], encodePublicKey()
    );
    await contract.waitForDeployment();
    return { contract, autoridad, votante };
  }

  it("inicializa autoridad, candidatos y estado cerrado", async function () {
    const { contract, autoridad } = await loadFixture(deployFixture);
    expect(await contract.owner()).to.equal(autoridad.address);
    expect(await contract.autoridad()).to.equal(autoridad.address);
    expect(await contract.estado()).to.equal(0n);
    expect((await contract.candidatos(1)).nombre).to.equal("Lista B");
  });

  it("solo la autoridad puede abrir y cerrar la urna", async function () {
    const { contract, votante } = await loadFixture(deployFixture);
    await expect(contract.connect(votante).abrirUrna()).to.be.revertedWith("Solo la autoridad electoral");
    await contract.abrirUrna();
    await expect(contract.connect(votante).cerrarUrna()).to.be.revertedWith("Solo la autoridad electoral");
    await expect(contract.cerrarUrna()).to.emit(contract, "UrnaCerrada");
  });

  it("contabiliza una credencial RSA canónica de 2048 bits", async function () {
    const { contract } = await loadFixture(deployFixture);
    const signedToken = buildSignedToken(42);
    await contract.abrirUrna();
    await expect(contract.emitirVoto(signedToken.payload, 1)).to.emit(contract, "VotoEmitido").withArgs(signedToken.tokenHash, 1);
    expect(await contract.totalVotosEmitidos()).to.equal(1n);
  });

  it("rechaza doble voto, firma adulterada y candidato inexistente", async function () {
    const { contract } = await loadFixture(deployFixture);
    const signedToken = buildSignedToken(99);
    await contract.abrirUrna();
    await contract.emitirVoto(signedToken.payload, 0);
    await expect(contract.emitirVoto(signedToken.payload, 2)).to.be.revertedWith("El token ya fue utilizado");
    const other = buildSignedToken(100);
    const forged = abiCoder.encode(["bytes", "bytes"], [other.token, bigintToBytes(1n, 256)]);
    await expect(contract.emitirVoto(forged, 0)).to.be.revertedWith("Token o firma invalidos");
    await expect(contract.emitirVoto(other.payload, 9)).to.be.revertedWith("Candidato invalido");
  });

  it("rechaza falsificación multiplicativa y formatos no canónicos", async function () {
    const { contract } = await loadFixture(deployFixture);
    const signedToken = buildSignedToken(17);
    const forgedMessage = modPow(credentialMessage(signedToken.token), 2n, rsaKey.n);
    const forgedSignature = (signedToken.signature * signedToken.signature) % rsaKey.n;
    const multiplicativeForgery = abiCoder.encode(
      ["bytes", "bytes"],
      [bigintToBytes(forgedMessage, 256), bigintToBytes(forgedSignature, 256)]
    );
    const shortToken = abiCoder.encode(["bytes", "bytes"], ["0x1234", signedToken.signatureHex]);
    const shortSignature = abiCoder.encode(["bytes", "bytes"], [signedToken.token, "0x01"]);
    await contract.abrirUrna();
    await expect(contract.emitirVoto(multiplicativeForgery, 0)).to.be.revertedWith("Token o firma invalidos");
    await expect(contract.emitirVoto(shortToken, 0)).to.be.revertedWith("Token o firma invalidos");
    await expect(contract.emitirVoto(shortSignature, 0)).to.be.revertedWith("Token o firma invalidos");
  });

  it("rechaza claves que no sean RSA de 2048 bits", async function () {
    const [autoridad] = await ethers.getSigners();
    const invalidKey = abiCoder.encode(["bytes", "bytes"], ["0x1234", "0x010001"]);
    await expect(new VotacionContract__factory(autoridad).deploy(["Lista A"], invalidKey)).to.be.revertedWith("Clave publica invalida");
  });

  it("rechaza el sufragio con la urna cerrada y con la urna finalizada", async function () {
    const { contract } = await loadFixture(deployFixture);
    const antes = buildSignedToken(70);
    // urna CERRADA: aun con credencial valida el voto se rechaza
    await expect(contract.emitirVoto.staticCall(antes.payload, 0)).to.be.revertedWith("La urna no esta abierta");
    await contract.abrirUrna();
    await contract.emitirVoto(antes.payload, 0);
    await contract.cerrarUrna();
    // urna FINALIZADA: idem
    const despues = buildSignedToken(71);
    await expect(contract.emitirVoto.staticCall(despues.payload, 0)).to.be.revertedWith("La urna no esta abierta");
    expect(await contract.totalVotosEmitidos()).to.equal(1n);
  });

  it("una urna finalizada no puede reabrirse ni volver a cerrarse (R11)", async function () {
    const { contract } = await loadFixture(deployFixture);
    await contract.abrirUrna();
    await contract.cerrarUrna();
    expect(await contract.estado()).to.equal(2n);
    await expect(contract.abrirUrna.staticCall()).to.be.revertedWith("La urna no puede abrirse");
    await expect(contract.cerrarUrna.staticCall()).to.be.revertedWith("La urna no esta abierta");
    expect(await contract.estado()).to.equal(2n);
  });

  it("rechaza una firma valida calculada sin separación de dominio", async function () {
    const { contract } = await loadFixture(deployFixture);
    const token = `0x${"00".repeat(31)}55`;
    // mensaje SIN el prefijo de dominio: SHA-256(token) a secas
    const sinDominio = BigInt(`0x${createHash("sha256").update(Buffer.from(token.slice(2), "hex")).digest("hex")}`);
    const firma = modPow(sinDominio, rsaKey.d, rsaKey.n);
    const payload = abiCoder.encode(["bytes", "bytes"], [token, bigintToBytes(firma, 256)]);
    await contract.abrirUrna();
    await expect(contract.emitirVoto.staticCall(payload, 0)).to.be.revertedWith("Token o firma invalidos");
    // y la misma credencial, firmada CON el dominio, si es aceptada
    const conDominio = abiCoder.encode(
      ["bytes", "bytes"],
      [token, bigintToBytes(modPow(credentialMessage(token), rsaKey.d, rsaKey.n), 256)]
    );
    await expect(contract.emitirVoto(conDominio, 0)).to.emit(contract, "VotoEmitido");
  });

  // Criterios de aceptacion de la Fase 1 del plan de remediacion (docs/):
  // "casos con firma multiplicada/potenciada, token de 31, 33 y 256 bytes,
  //  firma demasiado corta/larga, cero y valores fuera de rango; todos deben
  //  revertir salvo la credencial canonica valida".
  it("rechaza tokens y firmas no canonicos exigidos por el plan de remediación", async function () {
    const { contract } = await loadFixture(deployFixture);
    const valido = buildSignedToken(120);
    await contract.abrirUrna();

    const conToken = (tokenHex: string) => abiCoder.encode(["bytes", "bytes"], [tokenHex, valido.signatureHex]);
    const conFirma = (firmaHex: string) => abiCoder.encode(["bytes", "bytes"], [valido.token, firmaHex]);

    const casos: Array<[string, string]> = [
      ["token de 31 bytes", conToken(`0x${"11".repeat(31)}`)],
      ["token de 33 bytes", conToken(`0x${"11".repeat(33)}`)],
      ["token de 256 bytes", conToken(`0x${"11".repeat(256)}`)],
      ["token vacío", conToken("0x")],
      ["token cero de 32 bytes con firma ajena", conToken(`0x${"00".repeat(32)}`)],
      ["firma de 255 bytes", conFirma(`0x${"22".repeat(255)}`)],
      ["firma de 257 bytes", conFirma(`0x${"22".repeat(257)}`)],
      ["firma vacía", conFirma("0x")],
      ["firma cero", conFirma(`0x${"00".repeat(256)}`)]
    ];

    for (const [nombre, payload] of casos) {
      await expect(contract.emitirVoto.staticCall(payload, 0), nombre).to.be.revertedWith("Token o firma invalidos");
    }

    // La credencial canonica, en cambio, se contabiliza.
    await expect(contract.emitirVoto(valido.payload, 0)).to.emit(contract, "VotoEmitido");
  });

  it("documenta que una firma no canonica (s + n) no habilita un segundo voto", async function () {
    const { contract } = await loadFixture(deployFixture);
    const valido = buildSignedToken(121);
    await contract.abrirUrna();
    await contract.emitirVoto(valido.payload, 0);

    // s y s + n son congruentes modulo n: s + n es una codificacion no canonica
    // de la misma firma, que el precompilado reduciria al mismo mensaje. No sirve
    // para votar dos veces porque la deduplicacion del contrato opera sobre
    // keccak256(token) y el token no cambia. El control se aplica ademas antes de
    // la verificacion RSA, de modo que ni siquiera se llega a gastar gas en ella.
    const payload = abiCoder.encode(
      ["bytes", "bytes"],
      [valido.token, bigintToBytes(valido.signature + rsaKey.n)]
    );
    await expect(contract.emitirVoto.staticCall(payload, 1)).to.be.revertedWith("El token ya fue utilizado");
    expect(await contract.totalVotosEmitidos()).to.equal(1n);
  });
});
