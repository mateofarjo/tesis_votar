import { NextResponse } from "next/server";

import { createAuditLog } from "../../../../lib/audit";
import { getClientIp, getUserAgent } from "../../../../lib/request";
import { consumeRateLimit } from "../../../../lib/rateLimit";
import { processVeriffAttempt } from "../../../../lib/veriffWorkflow";
import {
  assertVeriffWebhookHmac,
  type VeriffDecisionPayload
} from "../../../../lib/veriff";

export async function POST(request: Request) {
  const clientIp = getClientIp(request.headers) ?? "unknown";
  const userAgent = getUserAgent(request.headers);
  const rateLimit = consumeRateLimit({
    identifier: clientIp,
    keyPrefix: "api:veriff:webhook",
    limit: 60,
    windowMs: 60_000
  });

  if (!rateLimit.success) {
    return NextResponse.json(
      { error: "Rate limit excedido para webhook de Veriff" },
      { status: 429 }
    );
  }

  const rawBody = await request.text();

  try {
    assertVeriffWebhookHmac(rawBody, request.headers);
  } catch {
    await createAuditLog({
      action: "WEBHOOK_VERIFF_INVALIDO",
      actorType: "WEBHOOK",
      ipAddress: clientIp,
      metadata: {
        reason: "Firma HMAC invalida"
      },
      resourceType: "veriff_webhook",
      userAgent
    });

    return NextResponse.json({ error: "Firma HMAC invalida" }, { status: 401 });
  }

  let payload: VeriffDecisionPayload;
  try {
    payload = JSON.parse(rawBody) as VeriffDecisionPayload;
  } catch {
    return NextResponse.json({ error: "Payload JSON invalido" }, { status: 400 });
  }

  const sessionId = payload.verification?.id;
  if (!sessionId) {
    return NextResponse.json(
      { error: "El webhook no incluye verification.id" },
      { status: 400 }
    );
  }

  await createAuditLog({
    action: "WEBHOOK_VERIFF_RECIBIDO",
    actorType: "WEBHOOK",
    ipAddress: clientIp,
    metadata: {
      sessionId,
      status: payload.verification?.status ?? null
    },
    resourceId: sessionId,
    resourceType: "veriff_session",
    userAgent
  });

  try {
    const result = await processVeriffAttempt(sessionId, payload);

    return NextResponse.json(
      {
        message: result.message,
        outcome: result.outcome,
        verificationStatus: result.verificationStatus
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("No se pudo procesar el webhook de Veriff", error);

    return NextResponse.json(
      { error: "No se pudo procesar el webhook de Veriff" },
      { status: 500 }
    );
  }
}
