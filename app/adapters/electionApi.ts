import type {
  ResultadosResponse,
  VoteReceipt,
  VoteTokenResponse,
} from "../services/election";

export function adaptResultados(payload: ResultadosResponse): ResultadosResponse {
  return {
    candidatos: payload.candidatos,
    contractAddress: payload.contractAddress,
    estadoUrna: payload.estadoUrna,
    resultadosPublicos: payload.resultadosPublicos,
    totalVotos: payload.totalVotos,
    updatedAt: payload.updatedAt,
  };
}

export function adaptVoteToken(payload: VoteTokenResponse): VoteTokenResponse {
  return {
    expiresAt: payload.expiresAt,
    tokenDigestHex: payload.tokenDigestHex,
    tokenFirmado: payload.tokenFirmado,
  };
}

export function adaptVoteReceipt(payload: VoteReceipt): VoteReceipt {
  return {
    blockNumber: payload.blockNumber,
    contractAddress: payload.contractAddress,
    transactionHash: payload.transactionHash,
  };
}
