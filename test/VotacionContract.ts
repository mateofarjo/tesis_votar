import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { VotacionContract__factory, type VotacionContract } from "../typechain-types";

const abiCoder = ethers.AbiCoder.defaultAbiCoder();

const RSA_N = 3233n;
const RSA_E = 17n;
const RSA_D = 2753n;

function bigintToBytes(value: bigint): string {
  if (value < 0n) {
    throw new Error("RSA no admite valores negativos");
  }

  let hex = value.toString(16);
  if (hex.length % 2 !== 0) {
    hex = `0${hex}`;
  }

  return `0x${hex}`;
}

function hexToBigint(value: string): bigint {
  return BigInt(value);
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  if (modulus === 1n) {
    return 0n;
  }

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

function encodePublicKey(): string {
  return abiCoder.encode(["bytes", "bytes"], [bigintToBytes(RSA_N), bigintToBytes(RSA_E)]);
}

function buildSignedToken(tokenByte: number) {
  const token = ethers.hexlify(Uint8Array.from([tokenByte]));
  const message = hexToBigint(token);
  const signature = bigintToBytes(modPow(message, RSA_D, RSA_N));
  const payload = abiCoder.encode(["bytes", "bytes"], [token, signature]);

  return {
    token,
    signature,
    payload,
    tokenHash: ethers.keccak256(token)
  };
}

describe("VotacionContract", function () {
  async function deployFixture() {
    const [autoridad, votante] = await ethers.getSigners();
    const factory = new VotacionContract__factory(autoridad);
    const contract: VotacionContract = await factory.deploy(
      ["Lista A", "Lista B", "Blanco"],
      encodePublicKey()
    );

    await contract.waitForDeployment();

    return { contract, autoridad, votante };
  }

  it("inicializa autoridad, candidatos y estado cerrado", async function () {
    const { contract, autoridad } = await loadFixture(deployFixture);

    expect(await contract.owner()).to.equal(autoridad.address);
    expect(await contract.autoridad()).to.equal(autoridad.address);
    expect(await contract.estado()).to.equal(0n);
    expect(await contract.fechaApertura()).to.equal(0n);
    expect(await contract.totalVotosEmitidos()).to.equal(0n);

    const candidato0 = await contract.candidatos(0);
    const candidato1 = await contract.candidatos(1);

    expect(candidato0.id).to.equal(0n);
    expect(candidato0.nombre).to.equal("Lista A");
    expect(candidato0.votos).to.equal(0n);
    expect(candidato1.id).to.equal(1n);
    expect(candidato1.nombre).to.equal("Lista B");
  });

  it("solo la autoridad puede abrir y cerrar la urna", async function () {
    const { contract, votante } = await loadFixture(deployFixture);

    await expect(contract.connect(votante).abrirUrna()).to.be.revertedWith("Solo la autoridad electoral");
    await expect(contract.abrirUrna()).to.emit(contract, "UrnaAbierta");
    expect(await contract.estado()).to.equal(1n);

    await expect(contract.abrirUrna()).to.be.revertedWith("La urna no puede abrirse");
    await expect(contract.connect(votante).cerrarUrna()).to.be.revertedWith("Solo la autoridad electoral");

    await expect(contract.cerrarUrna()).to.emit(contract, "UrnaCerrada");
    expect(await contract.estado()).to.equal(2n);
    expect(await contract.fechaCierre()).to.be.greaterThan(0n);

    await expect(contract.abrirUrna()).to.be.revertedWith("La urna no puede abrirse");
  });

  it("contabiliza un voto valido y emite el evento correspondiente", async function () {
    const { contract } = await loadFixture(deployFixture);
    const signedToken = buildSignedToken(42);

    await contract.abrirUrna();

    await expect(contract.emitirVoto(signedToken.payload, 1))
      .to.emit(contract, "VotoEmitido")
      .withArgs(signedToken.tokenHash, 1);

    expect(await contract.tokenUsado(signedToken.tokenHash)).to.equal(true);
    expect(await contract.totalVotosEmitidos()).to.equal(1n);

    const candidato = await contract.candidatos(1);
    expect(candidato.votos).to.equal(1n);

    const resultados = await contract.obtenerResultados();
    expect(resultados).to.have.length(3);
    expect(resultados[1].nombre).to.equal("Lista B");
    expect(resultados[1].votos).to.equal(1n);
  });

  it("rechaza el doble voto con el mismo token", async function () {
    const { contract } = await loadFixture(deployFixture);
    const signedToken = buildSignedToken(99);

    await contract.abrirUrna();
    await contract.emitirVoto(signedToken.payload, 0);

    await expect(contract.emitirVoto(signedToken.payload, 2)).to.be.revertedWith("El token ya fue utilizado");
  });

  it("rechaza firmas adulteradas", async function () {
    const { contract } = await loadFixture(deployFixture);
    const signedToken = buildSignedToken(17);
    const forgedPayload = abiCoder.encode(["bytes", "bytes"], [signedToken.token, "0x01"]);

    await contract.abrirUrna();

    await expect(contract.emitirVoto(forgedPayload, 0)).to.be.revertedWith("Token o firma invalidos");
  });

  it("rechaza candidato inexistente y votos fuera de ventana", async function () {
    const { contract } = await loadFixture(deployFixture);
    const signedToken = buildSignedToken(55);

    await expect(contract.emitirVoto(signedToken.payload, 0)).to.be.revertedWith("La urna no esta abierta");

    await contract.abrirUrna();

    await expect(contract.emitirVoto(signedToken.payload, 9)).to.be.revertedWith("Candidato invalido");
  });

  it("sincroniza autoridad al transferir ownership y bloquea renuncia", async function () {
    const { contract, votante } = await loadFixture(deployFixture);

    await contract.transferOwnership(votante.address);

    expect(await contract.owner()).to.equal(votante.address);
    expect(await contract.autoridad()).to.equal(votante.address);

    await expect(contract.renounceOwnership()).to.be.revertedWith("Operacion deshabilitada");
  });
});
