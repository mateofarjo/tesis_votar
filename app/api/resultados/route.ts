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
    const [estadoUrna, fechas] = await Promise.all([
      getEstadoActualUrna(),
      getFechasUrna()
    ]);

    // Los nombres se mantienen disponibles para construir la boleta, pero los
    // conteos nunca salen de esta API hasta el cierre definitivo de la urna.
    const candidatosContrato = await getResultadosContrato();
    const resultadosPublicos = estadoUrna === "FINALIZADA";
    const candidatos = candidatosContrato.map((candidato) => ({
      id: candidato.id,
      nombre: candidato.nombre,
      votos: resultadosPublicos ? candidato.votos : null
    }));
    const totalVotos = resultadosPublicos ? await getTotalVotosEmitidos() : null;

    return NextResponse.json(
      {
        candidatos,
        contractAddress: getContractAddress(),
        estadoUrna,
        fechaApertura: serializeUnixTimestamp(fechas.fechaApertura),
        fechaCierre: serializeUnixTimestamp(fechas.fechaCierre),
        resultadosPublicos,
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
