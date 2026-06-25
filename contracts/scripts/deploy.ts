import { createHash, createPublicKey } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { ethers, network } from "hardhat";

type RsaJwk = {
  kty?: string;
  n?: string;
  e?: string;
};

const abiCoder = ethers.AbiCoder.defaultAbiCoder();

function base64UrlToBuffer(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (normalized.length % 4)) % 4;

  return Buffer.from(normalized + "=".repeat(padding), "base64");
}

function normalizePem(rawPem: string): string {
  const replaced = rawPem.replace(/\\n/g, "\n").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (replaced.includes("\n")) {
    return replaced;
  }

  const beginMarker = "-----BEGIN PUBLIC KEY-----";
  const endMarker = "-----END PUBLIC KEY-----";

  if (!replaced.includes(beginMarker) || !replaced.includes(endMarker)) {
    return replaced;
  }

  const body = replaced
    .replace(beginMarker, "")
    .replace(endMarker, "")
    .replace(/\s+/g, "");

  const wrappedBody = body.match(/.{1,64}/g)?.join("\n") ?? body;
  return `${beginMarker}\n${wrappedBody}\n${endMarker}\n`;
}

function readCandidates(): string[] {
  const jsonValue = process.env.CANDIDATOS_JSON?.trim();
  if (jsonValue) {
    const parsed = JSON.parse(jsonValue);

    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
      throw new Error("CANDIDATOS_JSON debe ser un array JSON de strings");
    }

    const normalized = parsed.map((candidate) => candidate.trim()).filter(Boolean);
    if (normalized.length === 0) {
      throw new Error("CANDIDATOS_JSON no puede estar vacio");
    }

    return normalized;
  }

  const csvValue = process.env.CANDIDATOS?.trim();
  if (!csvValue) {
    throw new Error("Defini CANDIDATOS o CANDIDATOS_JSON antes de desplegar");
  }

  const candidates = csvValue
    .split(",")
    .map((candidate) => candidate.trim())
    .filter(Boolean);

  if (candidates.length === 0) {
    throw new Error("CANDIDATOS no puede quedar vacio despues del parseo");
  }

  return candidates;
}

function encodeAuthorityPublicKey(publicKeyPem: string) {
  const publicKey = createPublicKey(normalizePem(publicKeyPem));
  const exported = publicKey.export({ format: "jwk" }) as RsaJwk;

  if (exported.kty !== "RSA" || !exported.n || !exported.e) {
    throw new Error("RSA_PUBLIC_KEY_PEM debe ser una clave RSA publica valida");
  }

  const modulus = base64UrlToBuffer(exported.n);
  const exponent = base64UrlToBuffer(exported.e);

  const modulusHex = `0x${modulus.toString("hex")}`;
  const exponentHex = `0x${exponent.toString("hex")}`;
  const encoded = abiCoder.encode(["bytes", "bytes"], [modulusHex, exponentHex]);
  const fingerprint = createHash("sha256").update(modulus).digest("hex");

  return {
    encoded,
    exponentHex,
    fingerprint,
    modulusHex
  };
}

async function saveDeploymentArtifact(payload: Record<string, unknown>, address: string) {
  const outputDir = process.env.DEPLOYMENTS_DIR?.trim() || path.join(process.cwd(), "deployments");
  const jsonPath = path.join(outputDir, `${network.name}.json`);
  const envPath = path.join(outputDir, `${network.name}.env`);

  await mkdir(outputDir, { recursive: true });
  await writeFile(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  await writeFile(envPath, `CONTRACT_ADDRESS=${address}\n`, "utf8");

  return { envPath, jsonPath };
}

async function main() {
  const publicKeyPem = process.env.RSA_PUBLIC_KEY_PEM?.trim();
  if (!publicKeyPem) {
    throw new Error("Falta RSA_PUBLIC_KEY_PEM en el entorno");
  }

  const candidates = readCandidates();
  const { encoded, exponentHex, fingerprint, modulusHex } = encodeAuthorityPublicKey(publicKeyPem);
  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error("No hay signer disponible. Configura PRIVATE_KEY_AUTORIDAD para la red seleccionada");
  }

  const [deployer] = signers;
  const deployerAddress = await deployer.getAddress();
  const balanceBefore = await ethers.provider.getBalance(deployerAddress);

  console.log(`Red: ${network.name}`);
  console.log(`Authority wallet: ${deployerAddress}`);
  console.log(`Balance: ${ethers.formatEther(balanceBefore)} ETH`);
  console.log(`Candidatos: ${candidates.join(", ")}`);
  console.log(`RSA fingerprint: ${fingerprint}`);

  const contractFactory = await ethers.getContractFactory("VotacionContract");
  const contract = await contractFactory.deploy(candidates, encoded);
  await contract.waitForDeployment();

  const contractAddress = await contract.getAddress();
  const deploymentTx = contract.deploymentTransaction();
  const receipt = deploymentTx ? await deploymentTx.wait() : null;

  const deployment = {
    network: network.name,
    contractName: "VotacionContract",
    contractAddress,
    deployer: deployerAddress,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    transactionHash: deploymentTx?.hash ?? null,
    blockNumber: receipt?.blockNumber ?? null,
    deployedAt: new Date().toISOString(),
    candidates,
    rsaPublicKey: {
      fingerprint,
      modulusHex,
      exponentHex
    }
  };

  const savedPaths = await saveDeploymentArtifact(deployment, contractAddress);

  console.log(`Contrato desplegado en: ${contractAddress}`);
  console.log(`Tx hash: ${deployment.transactionHash}`);
  console.log(`JSON: ${savedPaths.jsonPath}`);
  console.log(`ENV: ${savedPaths.envPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
