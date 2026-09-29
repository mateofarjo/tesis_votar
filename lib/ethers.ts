import { readFileSync } from "node:fs";
import path from "node:path";

import {
  AlchemyProvider,
  Contract,
  JsonRpcProvider,
  Wallet,
  ethers,
  type ContractTransactionReceipt,
  type ContractTransactionResponse,
  type InterfaceAbi,
  type Log,
  type LogDescription
} from "ethers";

type ContractArtifact = {
  abi: InterfaceAbi;
};

export type EstadoUrna = "CERRADA" | "ABIERTA" | "FINALIZADA";

export type ResultadoCandidato = {
  id: number;
  nombre: string;
  votos: number;
};

export type VotoEmitidoEvent = {
  blockNumber: number;
  candidateId: number;
  tokenHash: string;
  transactionHash: string;
};

export type EmitirVotoInput = {
  candidatoId: number;
  tokenFirmado: string;
};

const ARTIFACT_PATH = path.join(
  process.cwd(),
  "lib",
  "abi",
  "VotacionContract.json"
);

const ESTADOS_URNA: EstadoUrna[] = ["CERRADA", "ABIERTA", "FINALIZADA"];

let cachedArtifact: ContractArtifact | null = null;
let cachedProvider: JsonRpcProvider | AlchemyProvider | null = null;
let cachedReadContract: Contract | null = null;
let cachedWriteContract: Contract | null = null;
let cachedAuthorityWallet: Wallet | null = null;

function getContractArtifact(): ContractArtifact {
  if (cachedArtifact) {
    return cachedArtifact;
  }

  const rawArtifact = readFileSync(ARTIFACT_PATH, "utf8");
  cachedArtifact = JSON.parse(rawArtifact) as ContractArtifact;
  return cachedArtifact;
}

function getRpcUrl(): string | undefined {
  const explicitUrl = process.env.ALCHEMY_RPC_URL?.trim();
  if (explicitUrl) {
    return explicitUrl;
  }

  const apiKey = process.env.ALCHEMY_API_KEY?.trim();
  if (!apiKey) {
    return undefined;
  }

  return `https://eth-sepolia.g.alchemy.com/v2/${apiKey}`;
}

export function getBlockchainProvider(): JsonRpcProvider | AlchemyProvider {
  if (cachedProvider) {
    return cachedProvider;
  }

  const rpcUrl = getRpcUrl();
  if (rpcUrl) {
    // Si es la red local de Hardhat (puerto 8545) usamos chainId 31337; para cualquier
    // otra URL dejamos que ethers detecte la red automáticamente (undefined = autodetect).
    const isLocal =
      rpcUrl.includes("127.0.0.1") ||
      rpcUrl.includes("localhost") ||
      rpcUrl.includes("0.0.0.0");
    const networkOrChainId = isLocal ? undefined : 11155111;
    cachedProvider = new JsonRpcProvider(rpcUrl, networkOrChainId);
    return cachedProvider;
  }

  const apiKey = process.env.ALCHEMY_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Falta ALCHEMY_RPC_URL o ALCHEMY_API_KEY en el entorno");
  }

  cachedProvider = new AlchemyProvider("sepolia", apiKey);
  return cachedProvider;
}

export type NetworkInfo = {
  chainId: number;
  /** Nombre legible de la red a la que apunta el proveedor configurado. */
  name: string;
  /** URL del explorador de bloques, o null si la red no tiene uno publico. */
  explorerUrl: string | null;
};

const REDES_CONOCIDAS: Record<number, { name: string; explorer: string | null }> = {
  1: { name: "Ethereum", explorer: "https://etherscan.io" },
  11155111: { name: "Sepolia", explorer: "https://sepolia.etherscan.io" },
  31337: { name: "Nodo local (Hardhat)", explorer: null },
  1337: { name: "Nodo local", explorer: null }
};

/**
 * Resuelve la red efectivamente configurada en lugar de asumir Sepolia.
 * Evita que la interfaz rotule como "Sepolia" un despliegue local y ofrezca
 * un enlace a un explorador donde el contrato no existe.
 */
export async function getNetworkInfo(): Promise<NetworkInfo> {
  const red = await getBlockchainProvider().getNetwork();
  const chainId = Number(red.chainId);
  const conocida = REDES_CONOCIDAS[chainId];
  return {
    chainId,
    name: conocida?.name ?? `Red ${chainId}`,
    explorerUrl: conocida?.explorer ?? null
  };
}

export function getContractAddress(): string {
  const contractAddress = process.env.CONTRACT_ADDRESS?.trim();
  if (!contractAddress) {
    throw new Error("Falta CONTRACT_ADDRESS en el entorno");
  }

  return contractAddress;
}

export function getAuthorityWallet(): Wallet {
  if (cachedAuthorityWallet) {
    return cachedAuthorityWallet;
  }

  const privateKey = process.env.PRIVATE_KEY_AUTORIDAD?.trim();
  if (!privateKey) {
    throw new Error("Falta PRIVATE_KEY_AUTORIDAD en el entorno");
  }

  cachedAuthorityWallet = new Wallet(privateKey, getBlockchainProvider());
  return cachedAuthorityWallet;
}

export function getVotacionReadContract(): Contract {
  if (cachedReadContract) {
    return cachedReadContract;
  }

  cachedReadContract = new Contract(
    getContractAddress(),
    getContractArtifact().abi,
    getBlockchainProvider()
  );

  return cachedReadContract;
}

export function getVotacionWriteContract(): Contract {
  if (cachedWriteContract) {
    return cachedWriteContract;
  }

  cachedWriteContract = new Contract(
    getContractAddress(),
    getContractArtifact().abi,
    getAuthorityWallet()
  );

  return cachedWriteContract;
}

export function parseEstadoUrna(value: bigint | number): EstadoUrna {
  const parsed = Number(value);
  const estado = ESTADOS_URNA[parsed];

  if (!estado) {
    throw new Error(`Estado de urna desconocido: ${value.toString()}`);
  }

  return estado;
}

export async function getEstadoActualUrna(): Promise<EstadoUrna> {
  const contract = getVotacionReadContract();
  return parseEstadoUrna((await contract.estado()) as bigint);
}

export async function getResultadosContrato(): Promise<ResultadoCandidato[]> {
  const contract = getVotacionReadContract();
  const results = (await contract.obtenerResultados()) as Array<{
    id: bigint;
    nombre: string;
    votos: bigint;
  }>;

  return results.map((candidate) => ({
    id: Number(candidate.id),
    nombre: candidate.nombre,
    votos: Number(candidate.votos)
  }));
}

export async function getTotalVotosEmitidos(): Promise<number> {
  const contract = getVotacionReadContract();
  return Number((await contract.totalVotosEmitidos()) as bigint);
}

export async function abrirUrna(): Promise<ContractTransactionReceipt | null> {
  const contract = getVotacionWriteContract();
  const tx = (await contract.abrirUrna()) as ContractTransactionResponse;
  return tx.wait();
}

export async function cerrarUrna(): Promise<ContractTransactionReceipt | null> {
  const contract = getVotacionWriteContract();
  const tx = (await contract.cerrarUrna()) as ContractTransactionResponse;
  return tx.wait();
}

/**
 * Simula `emitirVoto` contra el nodo sin enviar transaccion ni consumir gas.
 *
 * El endpoint de voto no exige autenticacion y el gas lo paga el retransmisor,
 * de modo que sin esta comprobacion cualquiera podria hacerle gastar fondos
 * enviando credenciales que el contrato va a rechazar. La llamada estatica
 * reproduce exactamente las condiciones de la transaccion real —incluida la
 * deduplicacion del token y el estado de la urna— y lanza con el motivo de
 * reversion si la credencial no procede.
 */
export async function simularEmitirVoto(input: EmitirVotoInput): Promise<void> {
  const contract = getVotacionWriteContract();
  await contract.emitirVoto.staticCall(input.tokenFirmado, input.candidatoId);
}

export async function emitirVotoEnContrato(
  input: EmitirVotoInput
): Promise<ContractTransactionReceipt | null> {
  const contract = getVotacionWriteContract();
  const tx = (await contract.emitirVoto(
    input.tokenFirmado,
    input.candidatoId
  )) as ContractTransactionResponse;

  return tx.wait();
}

function parseEventLog(log: Log): LogDescription | null {
  try {
    return getVotacionReadContract().interface.parseLog(log);
  } catch {
    return null;
  }
}

export async function getVotoEmitidoEvents(
  fromBlock: number | bigint = 0,
  toBlock: number | bigint | "latest" = "latest"
): Promise<VotoEmitidoEvent[]> {
  const contract = getVotacionReadContract();
  const eventFilter = contract.filters.VotoEmitido();
  const logs = await contract.queryFilter(eventFilter, fromBlock, toBlock);

  return logs
    .map((log) => {
      const parsedLog = parseEventLog(log);
      if (!parsedLog || parsedLog.name !== "VotoEmitido") {
        return null;
      }

      return {
        blockNumber: log.blockNumber,
        candidateId: Number(parsedLog.args[1]),
        tokenHash: parsedLog.args[0],
        transactionHash: log.transactionHash
      } satisfies VotoEmitidoEvent;
    })
    .filter((value): value is VotoEmitidoEvent => value !== null);
}

export async function getAutoridadOnChain(): Promise<string> {
  const contract = getVotacionReadContract();
  return (await contract.autoridad()) as string;
}

export async function getFechasUrna(): Promise<{
  fechaApertura: bigint;
  fechaCierre: bigint;
}> {
  const contract = getVotacionReadContract();

  const [fechaApertura, fechaCierre] = await Promise.all([
    contract.fechaApertura() as Promise<bigint>,
    contract.fechaCierre() as Promise<bigint>
  ]);

  return { fechaApertura, fechaCierre };
}
