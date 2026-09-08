import { NextResponse } from "next/server";

import { createAuditLog } from "../../../../lib/audit";
import { getIdentityVerificationAdapter } from "../../../../lib/identity-verification";
import { processIdentityVerificationAttempt } from "../../../../lib/identityVerificationWorkflow";
import { getClientIp, getUserAgent } from "../../../../lib/request";
import { consumeRateLimit } from "../../../../lib/rateLimit";

export async function POST(request: Request) {
  const identityVerification = getIdentityVerificationAdapter();
  const clientIp = getClientIp(request.headers) ?? "unknown";
  const userAgent = getUserAgent(request.headers);
  const rateLimit = consumeRateLimit({
    identifier: `${identityVerification.provider}:${clientIp}`,
    keyPrefix: "api:identity:webhook",
    limit: 60,
    windowMs: 60_000,
  });

  if (!rateLimit.success) {
    return NextResponse.json(
      { error: "Rate limit excedido para webhook de identidad" },
      { status: 429 },
    );
  }

  const rawBody = await request.text();

  try {
    identityVerification.assertWebhookHmac(rawBody, request.headers);
  } catch {
    await createAuditLog({
      action: "WEBHOOK_VERIFF_INVALIDO",
      actorType: "WEBHOOK",
      ipAddress: clientIp,
      metadata: {
        identityProvider: identityVerification.provider,
        reason: "Firma HMAC invalida",
      },
      resourceType: "identity_webhook",
      userAgent,
    });

    return NextResponse.json({ error: "Firma HMAC invalida" }, { status: 401 });
  }

  let webhook;
  try {
    webhook = identityVerification.parseWebhook(rawBody);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Payload JSON invalido";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  await createAuditLog({
    action: "WEBHOOK_VERIFF_RECIBIDO",
    actorType: "WEBHOOK",
    ipAddress: clientIp,
    metadata: {
      identityProvider: identityVerification.provider,
      sessionId: webhook.sessionId,
      status: webhook.status ?? null,
    },
    resourceId: webhook.sessionId,
    resourceType: "identity_session",
    userAgent,
  });

  try {
    const result = await processIdentityVerificationAttempt(
      webhook.sessionId,
      webhook.decision,
    );

    return NextResponse.json(
      {
        message: result.message,
        outcome: result.outcome,
        verificationStatus: result.verificationStatus,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("No se pudo procesar el webhook de identidad", error);

    return NextResponse.json(
      { error: "No se pudo procesar el webhook de identidad" },
      { status: 500 },
    );
  }
}
