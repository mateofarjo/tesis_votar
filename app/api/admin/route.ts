import { NextResponse } from "next/server";

import { getServerAuthSession } from "../../../lib/auth";
import { createAuditLog } from "../../../lib/audit";
import {
  abrirUrna,
  cerrarUrna,
  getContractAddress,
  getEstadoActualUrna,
  getFechasUrna,
  getResultadosContrato,
  getTotalVotosEmitidos
} from "../../../lib/ethers";
import prisma from "../../../lib/prisma";
import { getClientIp, getUserAgent } from "../../../lib/request";
import { consumeRateLimit } from "../../../lib/rateLimit";

export const dynamic = "force-dynamic";

type AdminAction = "ABRIR_URNA" | "CERRAR_URNA";

function serializeUnixTimestamp(value: bigint): string | null {
  return value > 0n ? value.toString() : null;
}

async function buildAdminSnapshot() {
  const [estadoUrna, candidatos, totalVotos, fechas, voters, padron] = await Promise.all([
    getEstadoActualUrna(),
    getResultadosContrato(),
    getTotalVotosEmitidos(),
    getFechasUrna(),
    prisma.voter.findMany({
      orderBy: {
        createdAt: "desc"
      },
      select: {
        createdAt: true,
        estado: true,
        id: true,
        verifiedAt: true,
        votoEmitido: true,
        votedAt: true
      }
    }),
    prisma.voter.groupBy({
      _count: {
        _all: true
      },
      by: ["estado"]
    })
  ]);

  const padronCounts = {
    registrados: 0,
    verificadas: 0,
    votoEmitido: 0
  };

  for (const item of padron) {
    if (item.estado === "REGISTRADO") {
      padronCounts.registrados = item._count._all;
    }

    if (item.estado === "VERIFICADO") {
      padronCounts.verificadas = item._count._all;
    }

    if (item.estado === "VOTO_EMITIDO") {
      padronCounts.votoEmitido = item._count._all;
    }
  }

  return {
    candidatos,
    contractAddress: getContractAddress(),
    estadoUrna,
    fechaApertura: serializeUnixTimestamp(fechas.fechaApertura),
    fechaCierre: serializeUnixTimestamp(fechas.fechaCierre),
    padron: {
      ...padronCounts,
      total: voters.length
    },
    totalVotos,
    updatedAt: new Date().toISOString(),
    voters: voters.map((voter) => ({
      createdAt: voter.createdAt.toISOString(),
      estado: voter.estado,
      id: voter.id,
      verifiedAt: voter.verifiedAt?.toISOString() ?? null,
      votoEmitido: voter.votoEmitido,
      votedAt: voter.votedAt?.toISOString() ?? null
    }))
  };
}

function isAdminAction(value: unknown): value is AdminAction {
  return value === "ABRIR_URNA" || value === "CERRAR_URNA";
}

export async function GET(request: Request) {
  const session = await getServerAuthSession();
  if (!session?.user || session.user.role !== "AUTORIDAD") {
    return NextResponse.json({ error: "Sesion no autorizada" }, { status: 401 });
  }

  const clientIp = getClientIp(request.headers) ?? "unknown";
  const rateLimit = consumeRateLimit({
    identifier: `${clientIp}:admin`,
    keyPrefix: "api:admin:read",
    limit: 60,
    windowMs: 60_000
  });

  if (!rateLimit.success) {
    return NextResponse.json({ error: "Demasiadas consultas de administracion" }, { status: 429 });
  }

  try {
    return NextResponse.json(await buildAdminSnapshot(), {
      headers: {
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    console.error("No se pudo construir el panel de administracion", error);

    return NextResponse.json(
      { error: "No se pudo construir el panel de administracion" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const session = await getServerAuthSession();
  if (!session?.user || session.user.role !== "AUTORIDAD") {
    return NextResponse.json({ error: "Sesion no autorizada" }, { status: 401 });
  }

  const clientIp = getClientIp(request.headers) ?? "unknown";
  const userAgent = getUserAgent(request.headers);
  const rateLimit = consumeRateLimit({
    identifier: `${clientIp}:admin`,
    keyPrefix: "api:admin:write",
    limit: 12,
    windowMs: 10 * 60_000
  });

  if (!rateLimit.success) {
    return NextResponse.json(
      { error: "Demasiadas acciones administrativas" },
      { status: 429 }
    );
  }

  let body: { action?: AdminAction };
  try {
    body = (await request.json()) as { action?: AdminAction };
  } catch {
    return NextResponse.json({ error: "El cuerpo JSON es invalido" }, { status: 400 });
  }

  if (!isAdminAction(body.action)) {
    return NextResponse.json(
      { error: "La accion administrativa es invalida" },
      { status: 400 }
    );
  }

  try {
    const receipt =
      body.action === "ABRIR_URNA" ? await abrirUrna() : await cerrarUrna();

    if (!receipt) {
      throw new Error("La transaccion administrativa no devolvio receipt");
    }

    await createAuditLog({
      action: body.action === "ABRIR_URNA" ? "URNA_ABIERTA" : "URNA_CERRADA",
      actorType: "AUTORIDAD",
      ipAddress: clientIp,
      metadata: {
        blockNumber: receipt.blockNumber,
        blockchainTxHash: receipt.hash
      },
      resourceId: receipt.hash,
      resourceType: "blockchain_transaction",
      userAgent
    });

    return NextResponse.json({
      action: body.action,
      blockNumber: receipt.blockNumber,
      contractAddress: getContractAddress(),
      transactionHash: receipt.hash
    });
  } catch (error) {
    console.error("No se pudo ejecutar la accion administrativa", error);

    return NextResponse.json(
      { error: "No se pudo ejecutar la accion administrativa" },
      { status: 500 }
    );
  }
}
