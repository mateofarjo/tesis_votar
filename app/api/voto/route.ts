import { NextResponse } from "next/server";

import { createAuditLog } from "../../../lib/audit";
import {
  decodeSignedVoteTokenFromContract,
  esCredencialValidaFueraDeCadena
} from "../../../lib/blindSignature";
import { getContractAddress } from "../../../lib/ethers";
import { encolarVoto } from "../../../lib/relayQueue";
import { getClientIp } from "../../../lib/request";
import { consumeRateLimit } from "../../../lib/rateLimit";

type VoteRequestBody = {
  candidatoId?: number;
  tokenFirmado?: string;
};

function isCanonicalVoteToken(tokenHex: string): boolean {
  return /^0x[0-9a-f]{64}$/i.test(tokenHex);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(request: Request) {
  const clientIp = getClientIp(request.headers) ?? "unknown";
  const rateLimit = await consumeRateLimit({
    identifier: clientIp,
    keyPrefix: "api:voto",
    limit: 30,
    windowMs: 10 * 60_000
  });

  if (!rateLimit.success) {
    return NextResponse.json(
      { error: "Demasiados intentos de emision de voto" },
      { status: 429 }
    );
  }

  let body: VoteRequestBody;
  try {
    body = (await request.json()) as VoteRequestBody;
  } catch {
    return NextResponse.json({ error: "El cuerpo JSON es invalido" }, { status: 400 });
  }

  const tokenFirmado = typeof body.tokenFirmado === "string" ? body.tokenFirmado.trim() : "";
  const candidatoId =
    typeof body.candidatoId === "number" && Number.isInteger(body.candidatoId)
      ? body.candidatoId
      : Number.NaN;

  if (!tokenFirmado || !Number.isInteger(candidatoId) || candidatoId < 0 || candidatoId > 255) {
    return NextResponse.json(
      { error: "tokenFirmado y candidatoId son obligatorios" },
      { status: 400 }
    );
  }

  let decodedToken;
  try {
    decodedToken = decodeSignedVoteTokenFromContract(tokenFirmado);
  } catch {
    return NextResponse.json(
      { error: "El tokenFirmado no tiene un formato ABI valido" },
      { status: 400 }
    );
  }

  if (!isCanonicalVoteToken(decodedToken.tokenDigestHex)) {
    return NextResponse.json(
      { error: "El tokenFirmado no contiene un token canonico de 32 bytes" },
      { status: 400 }
    );
  }

  // El gas lo paga el retransmisor y este endpoint no exige autenticacion: una
  // credencial mal formada o con firma invalida se descarta aqui, antes de
  // gastar un centavo en una transaccion que el contrato revertiria.
  if (!esCredencialValidaFueraDeCadena(decodedToken.tokenDigestHex, decodedToken.signatureHex)) {
    return NextResponse.json(
      { error: "La credencial no lleva una firma valida de la autoridad electoral" },
      { status: 400 }
    );
  }

  await createAuditLog({
    action: "VOTO_ENVIADO",
    actorType: "VOTER",
    metadata: {
      privacy: "anonymous_vote_submission_no_identity_network_or_candidate_metadata"
    },
    resourceType: "anonymous_vote"
  });

  try {
    // La cola aplica una demora aleatoria y baraja el lote antes de enviar, de
    // modo que el orden de las transacciones en la cadena no reproduzca el orden
    // en que las personas votaron. Ver lib/relayQueue.ts.
    const receipt = await encolarVoto({
      candidatoId,
      tokenFirmado
    });

    if (!receipt) {
      throw new Error("La transaccion no devolvio receipt");
    }

    await createAuditLog({
      action: "TOKEN_CONSUMIDO",
      actorType: "SISTEMA",
      metadata: {
        blockchainTxHash: receipt.hash,
        privacy: "token_consumed_on_chain_only"
      },
      resourceId: receipt.hash,
      resourceType: "blockchain_transaction"
    });

    await createAuditLog({
      action: "VOTO_CONFIRMADO",
      actorType: "SISTEMA",
      metadata: {
        blockNumber: receipt.blockNumber,
        blockchainTxHash: receipt.hash,
        privacy: "no_voter_id_vote_token_id_network_or_candidate_stored"
      },
      resourceId: receipt.hash,
      resourceType: "blockchain_transaction"
    });

    return NextResponse.json({
      blockNumber: receipt.blockNumber,
      contractAddress: getContractAddress(),
      transactionHash: receipt.hash
    });
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    console.error("No se pudo emitir el voto en blockchain", error);

    const status =
      errorMessage.includes("Candidato invalido") ||
      errorMessage.includes("Token o firma invalidos") ||
      errorMessage.includes("La urna no esta abierta") ||
      errorMessage.includes("El token ya fue utilizado")
        ? 409
        : 500;

    return NextResponse.json(
      { error: "No se pudo emitir el voto", details: errorMessage },
      { status }
    );
  }
}
