import {
  adaptResultados,
  adaptVoteReceipt,
  adaptVoteToken,
} from "../adapters/electionApi";
import { readApiJson } from "../adapters/apiResponse";

export type ResultadoCandidato = { id: number; nombre: string; votos: number };

export type ResultadosResponse = {
  candidatos: ResultadoCandidato[];
  contractAddress: string;
  estadoUrna: "ABIERTA" | "CERRADA" | "FINALIZADA";
  totalVotos: number;
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
  const response = await fetch("/api/generar-token", { method: "POST" });

  return adaptVoteToken(
    await readApiJson<VoteTokenResponse>(
      response,
      "No se pudo generar el token de voto",
    ),
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

  return adaptVoteReceipt(
    await readApiJson<VoteReceipt>(response, "No se pudo emitir el voto"),
  );
}
