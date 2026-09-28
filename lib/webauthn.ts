import { randomBytes } from "node:crypto";
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse, type AuthenticationResponseJSON, type RegistrationResponseJSON } from "@simplewebauthn/server";
import prisma from "./prisma";

const TTL_MS = 5 * 60_000;
function config() {
  const origin = process.env.NEXTAUTH_URL?.replace(/\/$/, "") || "http://localhost:3000";
  return { origin, rpID: process.env.WEBAUTHN_RP_ID?.trim() || new URL(origin).hostname, rpName: process.env.WEBAUTHN_RP_NAME?.trim() || "Vot.Ar" };
}
async function remember(voterId: string, purpose: string, challenge: string) {
  await prisma.webAuthnChallenge.deleteMany({ where: { voterId, purpose } });
  await prisma.webAuthnChallenge.create({ data: { voterId, purpose, challenge, expiresAt: new Date(Date.now() + TTL_MS) } });
}
async function consume(voterId: string, purpose: string, challenge: string) {
  const row = await prisma.webAuthnChallenge.findFirst({ where: { voterId, purpose, challenge, expiresAt: { gt: new Date() } } });
  if (!row) throw new Error("Desafio WebAuthn invalido o expirado");
  await prisma.webAuthnChallenge.delete({ where: { id: row.id } });
}
export async function beginRegistration(voterId: string) {
  const voter = await prisma.voter.findUniqueOrThrow({ include: { passkeys: true }, where: { id: voterId } });
  const c = config();
  const options = await generateRegistrationOptions({ rpName: c.rpName, rpID: c.rpID, userName: `voter-${voter.id}`, userID: new TextEncoder().encode(voter.id), authenticatorSelection: { userVerification: "required" }, excludeCredentials: voter.passkeys.map(p => ({ id: p.credentialId, transports: p.transports as never })) });
  await remember(voter.id, "REGISTER", options.challenge);
  return options;
}
export async function finishRegistration(voterId: string, response: RegistrationResponseJSON) {
  const c = config(); const challenge = await prisma.webAuthnChallenge.findFirst({ where: { voterId, purpose: "REGISTER" }, orderBy: { expiresAt: "desc" } });
  if (!challenge) throw new Error("No hay desafio de registro activo");
  const verified = await verifyRegistrationResponse({ response, expectedChallenge: challenge.challenge, expectedOrigin: c.origin, expectedRPID: c.rpID, requireUserVerification: true });
  await consume(voterId, "REGISTER", challenge.challenge);
  if (!verified.verified) throw new Error("No se pudo verificar la passkey");
  const credential = verified.registrationInfo.credential;
  await prisma.passkey.upsert({ where: { credentialId: credential.id }, create: { voterId, credentialId: credential.id, publicKey: Buffer.from(credential.publicKey), counter: BigInt(credential.counter), transports: credential.transports ?? [] }, update: { publicKey: Buffer.from(credential.publicKey), counter: BigInt(credential.counter), transports: credential.transports ?? [] } });
}
export async function beginAuthentication(dniHash: string) {
  const voter = await prisma.voter.findUnique({ include: { passkeys: true }, where: { dniHash } });
  if (!voter || !voter.passkeys.length) throw new Error("Credenciales no validas");
  const options = await generateAuthenticationOptions({ rpID: config().rpID, userVerification: "required", allowCredentials: voter.passkeys.map(p => ({ id: p.credentialId, transports: p.transports as never })) });
  await remember(voter.id, "AUTH", options.challenge); return options;
}
export async function finishAuthentication(response: AuthenticationResponseJSON) {
  const passkey = await prisma.passkey.findUnique({ include: { voter: true }, where: { credentialId: response.id } });
  if (!passkey) throw new Error("Credenciales no validas");
  const challenge = await prisma.webAuthnChallenge.findFirst({ where: { voterId: passkey.voterId, purpose: "AUTH" }, orderBy: { expiresAt: "desc" } });
  if (!challenge) throw new Error("Desafio de autenticacion invalido");
  const c = config(); const verified = await verifyAuthenticationResponse({ response, expectedChallenge: challenge.challenge, expectedOrigin: c.origin, expectedRPID: c.rpID, requireUserVerification: true, credential: { id: passkey.credentialId, publicKey: new Uint8Array(passkey.publicKey), counter: Number(passkey.counter), transports: passkey.transports as never } });
  await consume(passkey.voterId, "AUTH", challenge.challenge); if (!verified.verified) throw new Error("Credenciales no validas");
  await prisma.passkey.update({ where: { id: passkey.id }, data: { counter: BigInt(verified.authenticationInfo.newCounter), lastUsedAt: new Date() } });
  const ticket = randomBytes(32).toString("base64url"); await remember(passkey.voterId, "TICKET", ticket); return ticket;
}
export async function consumeLoginTicket(ticket: string) {
  const row = await prisma.webAuthnChallenge.findFirst({ where: { purpose: "TICKET", challenge: ticket, expiresAt: { gt: new Date() } } });
  if (!row) return null; await prisma.webAuthnChallenge.delete({ where: { id: row.id } }); return prisma.voter.findUnique({ where: { id: row.voterId } });
}
