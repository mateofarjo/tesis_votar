import type { ActorType, AuditAction, Prisma } from "@prisma/client";

import { encolarEntradaDiferida } from "./auditBuffer";
import {
  descripcionDeCubeta,
  requiereCubeteo,
  identificadorNoOrdenable,
  instanteCubeteado
} from "./auditPrivacy";
import { hashIpAddress, hashUserAgent } from "./biometricHash";
import prisma from "./prisma";

type CreateAuditLogInput = {
  action: AuditAction;
  actorType: ActorType;
  ipAddress?: string;
  metadata?: Prisma.InputJsonValue | null;
  resourceId?: string;
  resourceType?: string;
  sessionId?: string;
  userAgent?: string;
  voteTokenId?: string;
  voterId?: string;
};

export async function createAuditLog(input: CreateAuditLogInput): Promise<void> {
  // Las entradas que permiten correlacionar a una persona con un sufragio se
  // registran con marca temporal truncada a su cubeta y con identificador
  // aleatorio, de modo que dentro de una cubeta no exista orden relativo
  // legible. Ver lib/auditPrivacy.ts.
  const correlacionable = requiereCubeteo(input.action, Boolean(input.voterId));
  const metadataBase = input.metadata ?? undefined;

  const datos = {
    ...(correlacionable
      ? { createdAt: instanteCubeteado(), id: identificadorNoOrdenable() }
      : {}),
    action: input.action,
    actorType: input.actorType,
    ipHash: input.ipAddress ? hashIpAddress(input.ipAddress) : null,
    metadata: correlacionable
      ? {
          ...(typeof metadataBase === "object" && metadataBase !== null && !Array.isArray(metadataBase)
                ? metadataBase
            : {}),
          timeGranularity: descripcionDeCubeta()
        }
      : metadataBase,
    resourceId: input.resourceId ?? null,
    resourceType: input.resourceType ?? null,
    sessionId: input.sessionId ?? null,
    userAgentHash: input.userAgent ? hashUserAgent(input.userAgent) : null,
    voteTokenId: input.voteTokenId ?? null,
    voterId: input.voterId ?? null
  };

  // Las entradas cubeteadas no se escriben de inmediato: se acumulan y se
  // insertan en lote barajado al cerrar la ventana. Escribirlas al vuelo
  // conservaria el orden fisico de las filas, que es orden de insercion y por
  // tanto orden de los votantes. Ver lib/auditBuffer.ts.
  if (correlacionable) {
    encolarEntradaDiferida(datos);
    return;
  }

  try {
    await prisma.auditLog.create({ data: datos });
  } catch (error) {
    console.error("No se pudo registrar el audit log", error);
  }
}
