import { NextResponse } from "next/server";

import { getServerAuthSession } from "../../../lib/auth";
import { createAuditLog } from "../../../lib/audit";
import { decodeSignedVoteTokenFromContract } from "../../../lib/blindSignature";
import {
  emitirVotoEnContrato,
  getContractAddress
} from "../../../lib/ethers";
import prisma from "../../../lib/prisma";
import { getClientIp, getUserAgent, sha256Hex } from "../../../lib/request";
import { consumeRateLimit } from "../../../lib/rateLimit";

type VoteRequestBody = {
  candidatoId?: number;
  tokenFirmado?: string;
};

function normalizeTokenDigestHex(tokenDigestHex: string): string {
  return tokenDigestHex.replace(/^0x/, "").toLowerCase();
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(request: Request) {
  const session = await getServerAuthSession();
  if (!session?.user || session.user.role !== "VOTANTE" || !session.user.voterId) {
    return NextResponse.json({ error: "Sesion no autorizada" }, { status: 401 });
  }

  const clientIp = getClientIp(request.headers) ?? "unknown";
  const userAgent = getUserAgent(request.headers);
  const rateLimit = consumeRateLimit({
    identifier: `${clientIp}:${session.user.voterId}`,
    keyPrefix: "api:voto",
    limit: 10,
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

  if (!tokenFirmado || !Number.isInteger(candidatoId) || candidatoId < 0) {
    return NextResponse.json(
      { error: "tokenFirmado y candidatoId son obligatorios" },
      { status: 400 }
    );
  }

  const voter = await prisma.voter.findUnique({
    select: {
      estado: true,
      id: true,
      votoEmitido: true
    },
    where: {
      id: session.user.voterId
    }
  });

  if (!voter) {
    return NextResponse.json({ error: "Votante no encontrado" }, { status: 404 });
  }

  if (voter.votoEmitido || voter.estado === "VOTO_EMITIDO") {
    return NextResponse.json(
      { error: "El votante ya emitio su voto" },
      { status: 409 }
    );
  }

  const signedTokenHash = sha256Hex(tokenFirmado);
  const voteToken = await prisma.voteToken.findFirst({
    where: {
      signedTokenHash,
      status: "EMITIDO",
      voterId: voter.id
    }
  });

  if (!voteToken) {
    return NextResponse.json(
      { error: "No existe un token emitido valido para este votante" },
      { status: 404 }
    );
  }

  if (voteToken.expiresAt.getTime() <= Date.now()) {
    await prisma.voteToken.update({
      data: {
        status: "EXPIRADO"
      },
      where: {
        id: voteToken.id
      }
    });

    return NextResponse.json(
      { error: "El token de voto expiro. Genera uno nuevo." },
      { status: 410 }
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

  if (normalizeTokenDigestHex(decodedToken.tokenDigestHex) !== voteToken.tokenHash) {
    return NextResponse.json(
      { error: "El tokenFirmado no coincide con el token emitido para el votante" },
      { status: 400 }
    );
  }

  await createAuditLog({
    action: "VOTO_ENVIADO",
    actorType: "VOTER",
    ipAddress: clientIp,
    metadata: {
      candidatoId
    },
    resourceId: voteToken.id,
    resourceType: "vote_token",
    userAgent,
    voteTokenId: voteToken.id,
    voterId: voter.id
  });

  try {
    const receipt = await emitirVotoEnContrato({
      candidatoId,
      tokenFirmado
    });

    if (!receipt) {
      throw new Error("La transaccion no devolvio receipt");
    }

    const usedAt = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.voteToken.update({
        data: {
          blockchainTxHash: receipt.hash,
          status: "CONSUMIDO",
          usedAt
        },
        where: {
          id: voteToken.id
        }
      });

      await tx.voter.update({
        data: {
          estado: "VOTO_EMITIDO",
          votoEmitido: true,
          votedAt: usedAt
        },
        where: {
          id: voter.id
        }
      });
    });

    await createAuditLog({
      action: "TOKEN_CONSUMIDO",
      actorType: "SISTEMA",
      ipAddress: clientIp,
      metadata: {
        blockchainTxHash: receipt.hash
      },
      resourceId: voteToken.id,
      resourceType: "vote_token",
      userAgent,
      voteTokenId: voteToken.id,
      voterId: voter.id
    });

    await createAuditLog({
      action: "VOTO_CONFIRMADO",
      actorType: "SISTEMA",
      ipAddress: clientIp,
      metadata: {
        blockNumber: receipt.blockNumber,
        blockchainTxHash: receipt.hash,
        candidatoId
      },
      resourceId: receipt.hash,
      resourceType: "blockchain_transaction",
      userAgent,
      voteTokenId: voteToken.id,
      voterId: voter.id
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
