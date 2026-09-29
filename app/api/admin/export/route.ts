import { NextResponse } from "next/server";

import { getServerAuthSession } from "../../../../lib/auth";
import {
  getContractAddress,
  getEstadoActualUrna,
  getFechasUrna,
  getResultadosContrato,
  getTotalVotosEmitidos
} from "../../../../lib/ethers";
import prisma from "../../../../lib/prisma";
import { getClientIp } from "../../../../lib/request";
import { consumeRateLimit } from "../../../../lib/rateLimit";

export const dynamic = "force-dynamic";

function serializeUnixTimestamp(value: bigint): string | null {
  return value > 0n ? value.toString() : null;
}

export async function GET(request: Request) {
  const session = await getServerAuthSession();
  if (!session?.user || session.user.role !== "AUTORIDAD") {
    return NextResponse.json({ error: "Sesion no autorizada" }, { status: 401 });
  }

  const clientIp = getClientIp(request.headers) ?? "unknown";
  const rateLimit = await consumeRateLimit({
    identifier: `${clientIp}:admin`,
    keyPrefix: "api:admin:export",
    limit: 10,
    windowMs: 10 * 60_000
  });

  if (!rateLimit.success) {
    return NextResponse.json(
      { error: "Demasiadas exportaciones solicitadas" },
      { status: 429 }
    );
  }

  try {
    const [estadoUrna, candidatos, totalVotos, fechas, voters] = await Promise.all([
      getEstadoActualUrna(),
      getResultadosContrato(),
      getTotalVotosEmitidos(),
      getFechasUrna(),
      prisma.voter.findMany({
        orderBy: {
          createdAt: "asc"
        },
        select: {
          createdAt: true,
          estado: true,
          id: true,
          verifiedAt: true
        }
      })
    ]);

    const payload = {
      candidatos,
      contractAddress: getContractAddress(),
      estadoUrna,
      exportadoEn: new Date().toISOString(),
      fechaApertura: serializeUnixTimestamp(fechas.fechaApertura),
      fechaCierre: serializeUnixTimestamp(fechas.fechaCierre),
      totalVotos,
      voters: voters.map((voter: typeof voters[number]) => ({
        createdAt: voter.createdAt.toISOString(),
        estado: voter.estado,
        id: voter.id,
        verifiedAt: voter.verifiedAt?.toISOString() ?? null,
      }))
    };

    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": 'attachment; filename="votar-resultados.json"',
        "Content-Type": "application/json; charset=utf-8"
      },
      status: 200
    });
  } catch (error) {
    console.error("No se pudo exportar el JSON administrativo", error);

    return NextResponse.json(
      { error: "No se pudo exportar el JSON administrativo" },
      { status: 500 }
    );
  }
}
