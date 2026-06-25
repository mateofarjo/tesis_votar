import { NextResponse } from "next/server";

import {
  getContractAddress,
  getEstadoActualUrna,
  getFechasUrna,
  getResultadosContrato,
  getTotalVotosEmitidos
} from "../../../lib/ethers";
import { getClientIp } from "../../../lib/request";
import { consumeRateLimit } from "../../../lib/rateLimit";

export const dynamic = "force-dynamic";

function serializeUnixTimestamp(value: bigint): string | null {
  return value > 0n ? value.toString() : null;
}

export async function GET(request: Request) {
  const clientIp = getClientIp(request.headers) ?? "unknown";
  const rateLimit = consumeRateLimit({
    identifier: clientIp,
    keyPrefix: "api:resultados",
    limit: 90,
    windowMs: 60_000
  });

  if (!rateLimit.success) {
    return NextResponse.json(
      { error: "Demasiadas consultas de resultados" },
      { status: 429 }
    );
  }

  try {
    const [estadoUrna, candidatos, totalVotos, fechas] = await Promise.all([
      getEstadoActualUrna(),
      getResultadosContrato(),
      getTotalVotosEmitidos(),
      getFechasUrna()
    ]);

    return NextResponse.json(
      {
        candidatos,
        contractAddress: getContractAddress(),
        estadoUrna,
        fechaApertura: serializeUnixTimestamp(fechas.fechaApertura),
        fechaCierre: serializeUnixTimestamp(fechas.fechaCierre),
        totalVotos,
        updatedAt: new Date().toISOString()
      },
      {
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  } catch (error) {
    console.error("No se pudieron obtener los resultados publicos", error);

    return NextResponse.json(
      { error: "No se pudieron obtener los resultados publicos" },
      { status: 500 }
    );
  }
}
