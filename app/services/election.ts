import {
  adaptResultados,
  adaptVoteReceipt,
  adaptVoteToken,
} from "../adapters/electionApi";
import { readApiJson } from "../adapters/apiResponse";
import {
  clearStoredVoteCredential,
  createAnonymousVoteCredential,
  getStoredVoteCredential,
  type BlindSignaturePublicKeyResponse,
  type SignedBlindVoteTokenResponse,
} from "./blindVoteToken";

export type ResultadoCandidato = { id: number; nombre: string; votos: number | null };

export type ResultadosResponse = {
  candidatos: ResultadoCandidato[];
  contractAddress: string;
  estadoUrna: "ABIERTA" | "CERRADA" | "FINALIZADA";
  resultadosPublicos: boolean;
  totalVotos: number | null;
  updatedAt: string;
};

export type VoteTokenResponse = {
  candidatoId: number;
  expiresAt: string;
  tokenDigestHex: string;
  tokenFirmado: string;
};

export type VoteReceipt = {
  blockNumber: number;
  contractAddress: string;
  transactionHash: string;
};

export async function getResultados(): Promise<ResultadosResponse> {
  const response = await fetch("/api/resultados", {
    cache: "no-store",
  });

  return adaptResultados(
    await readApiJson<ResultadosResponse>(
      response,
      "No se pudieron leer los resultados",
    ),
  );
}

/**
 * Emite la credencial anonima para un candidato determinado.
 *
 * El candidato es ahora un parametro de la emision y no del envio: forma parte
 * del mensaje que la autoridad firma a ciegas, de modo que la eleccion queda
 * comprometida en este punto. Una credencial guardada para otra opcion no sirve.
 */
export async function createVoteToken(candidatoId: number): Promise<VoteTokenResponse> {
  const storedCredential = getStoredVoteCredential();
  if (storedCredential && storedCredential.candidatoId === candidatoId) {
    return storedCredential;
  }
  if (storedCredential) {
    // Hay una credencial emitida para otra opcion. No se descarta en silencio:
    // el servidor no emitira una segunda, de modo que quien cambia de opinion
    // despues de pedirla queda sin poder votar y debe saberlo.
    throw new Error(
      "Ya se emitio una credencial para otra opcion. La eleccion queda fijada al pedir la credencial y el sistema no emite una segunda.",
    );
  }

  const publicKeyResponse = await fetch("/api/generar-token", {
    cache: "no-store",
  });
  const publicKey = await readApiJson<BlindSignaturePublicKeyResponse>(
    publicKeyResponse,
    "No se pudo obtener la clave publica de voto",
  );

  const preparedCredential = await createAnonymousVoteCredential(publicKey, candidatoId);
  const signResponse = await fetch("/api/generar-token", {
    body: JSON.stringify({
      blindedToken: preparedCredential.blindedToken,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  const signedBlindToken = await readApiJson<SignedBlindVoteTokenResponse>(
    signResponse,
    "No se pudo generar el token de voto",
  );

  return adaptVoteToken(
    preparedCredential.unblindSignedToken(signedBlindToken),
  );
}

export async function submitVote({
  candidatoId,
  tokenFirmado,
}: {
  candidatoId: number;
  tokenFirmado: string;
}): Promise<VoteReceipt> {
  const response = await fetch("/api/voto", {
    body: JSON.stringify({
      candidatoId,
      tokenFirmado,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  const receipt = adaptVoteReceipt(
    await readApiJson<VoteReceipt>(response, "No se pudo emitir el voto"),
  );
  clearStoredVoteCredential();
  return receipt;
}
