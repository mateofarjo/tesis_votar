import { NextResponse } from "next/server";
import { hashDni } from "../../../lib/biometricHash";
import { getServerAuthSession } from "../../../lib/auth";
import { beginAuthentication, beginRegistration, finishAuthentication, finishRegistration } from "../../../lib/webauthn";
import prisma from "../../../lib/prisma";

async function getRegistrationVoter(sessionId: string | undefined) {
  if (!sessionId) return null;
  return prisma.verificationAttempt.findFirst({
    select: { voterId: true },
    where: { veriffSessionId: sessionId, type: "REGISTRO", status: "APROBADO", resolvedAt: { gt: new Date(Date.now() - 15 * 60_000) }, voterId: { not: null } },
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: string; dni?: string; response?: unknown; verificationSessionId?: string };
    if (body.action === "register-options" || body.action === "register-verify") {
      const session = await getServerAuthSession();
      const registration = session?.user.voterId ? null : await getRegistrationVoter(body.verificationSessionId);
      const voterId = session?.user.voterId ?? registration?.voterId;
      if (!voterId) return NextResponse.json({ error: "Sesion o registro aprobado reciente requerido" }, { status: 401 });
      if (body.action === "register-options") return NextResponse.json(await beginRegistration(voterId));
      await finishRegistration(voterId, body.response as never); return NextResponse.json({ verified: true });
    }
    if (body.action === "auth-options") return NextResponse.json(await beginAuthentication(hashDni(body.dni ?? "")));
    if (body.action === "auth-verify") return NextResponse.json({ ticket: await finishAuthentication(body.response as never) });
    return NextResponse.json({ error: "Accion invalida" }, { status: 400 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo procesar la passkey" }, { status: 400 }); }
}
