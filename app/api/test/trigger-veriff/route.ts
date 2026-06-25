/**
 * Endpoint de prueba local — simula el webhook de Veriff.
 * SOLO disponible en development (NODE_ENV !== "production").
 *
 * POST /api/test/trigger-veriff
 * Body: { sessionId: string, type: "REGISTRO" | "LIVENESS", approved?: boolean }
 *
 * Llama a processVeriffAttempt directamente con un payload "approved" falso
 * que incluye datos biométricos fijos para que registro y liveness siempre coincidan.
 */

import { NextResponse } from "next/server";

import { processVeriffAttempt } from "../../../../lib/veriffWorkflow";
import type { VeriffDecisionPayload } from "../../../../lib/veriff";

type TriggerBody = {
  approved?: boolean;
  sessionId: string;
  type?: "REGISTRO" | "LIVENESS";
};

// Datos biométricos fijos: todos los test-voters comparten la misma "cara"
// para que registro y liveness siempre coincidan en entorno local.
const MOCK_BIOMETRIC_DATA = {
  confidence: 0.9987,
  faceEmbedding: [0.12, -0.34, 0.56, 0.78, -0.90, 0.11, 0.23, -0.45],
  livenessScore: 0.9971,
  mockSource: "local-dev-fixed-biometric"
};

function buildApprovedPayload(sessionId: string): VeriffDecisionPayload {
  return {
    status: "success",
    verification: {
      additionalVerifiedData: MOCK_BIOMETRIC_DATA,
      attemptId: `mock-attempt-${sessionId}`,
      biometricAuthentication: {
        details: MOCK_BIOMETRIC_DATA,
        matchedSessionEndUserId: null,
        matchedSessionId: null,
        matchedSessionVendorData: null
      },
      code: 9001,
      id: sessionId,
      reason: null,
      reasonCode: null,
      status: "approved",
      vendorData: "local-dev"
    }
  };
}

function buildDeclinedPayload(sessionId: string): VeriffDecisionPayload {
  return {
    status: "success",
    verification: {
      attemptId: `mock-attempt-${sessionId}`,
      code: 9103,
      id: sessionId,
      reason: "Simulacion de rechazo para pruebas",
      reasonCode: "1103",
      status: "declined"
    }
  };
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Endpoint no disponible en produccion" },
      { status: 403 }
    );
  }

  let body: TriggerBody;
  try {
    body = (await request.json()) as TriggerBody;
  } catch {
    return NextResponse.json({ error: "Body JSON invalido" }, { status: 400 });
  }

  const { sessionId, approved = true } = body;

  if (!sessionId || typeof sessionId !== "string") {
    return NextResponse.json(
      { error: "sessionId requerido (string)" },
      { status: 400 }
    );
  }

  const fakePayload = approved
    ? buildApprovedPayload(sessionId)
    : buildDeclinedPayload(sessionId);

  try {
    const result = await processVeriffAttempt(sessionId, fakePayload);
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error procesando el intento";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
