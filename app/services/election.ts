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

export async function createVoteToken(): Promise<VoteTokenResponse> {
  const storedCredential = getStoredVoteCredential();
  if (storedCredential) {
    return storedCredential;
  }

  const publicKeyResponse = await fetch("/api/generar-token", {
    cache: "no-store",
  });
  const publicKey = await readApiJson<BlindSignaturePublicKeyResponse>(
    publicKeyResponse,
    "No se pudo obtener la clave publica de voto",
  );

  const preparedCredential = await createAnonymousVoteCredential(publicKey);
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
