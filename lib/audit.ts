import type { ActorType, AuditAction, Prisma } from "@prisma/client";

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
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        actorType: input.actorType,
        ipHash: input.ipAddress ? hashIpAddress(input.ipAddress) : null,
        metadata: input.metadata ?? undefined,
        resourceId: input.resourceId ?? null,
        resourceType: input.resourceType ?? null,
        sessionId: input.sessionId ?? null,
        userAgentHash: input.userAgent ? hashUserAgent(input.userAgent) : null,
        voteTokenId: input.voteTokenId ?? null,
        voterId: input.voterId ?? null
      }
    });
  } catch (error) {
    console.error("No se pudo registrar el audit log", error);
  }
}
