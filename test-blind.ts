// test-blind.ts — adaptado a la API real de lib/blindSignature.ts
import {
  blindVoteToken,
  generateKeyPair,
  generateVoteToken,
  getBlindSignaturePublicKey,
  issueBlindSignedVoteToken,
  signBlindToken,
  unblindSignedToken,
  verifyUnblindedToken
} from "./lib/blindSignature";

async function main() {
  let passed = 0;
  let failed = 0;

  function ok(label: string, condition: boolean) {
    if (condition) {
      console.log(`✓ ${label}`);
      passed++;
    } else {
      console.log(`✗ ${label}`);
      failed++;
    }
  }

  // ── Test 1: generar claves ──
  const { privateKey, publicKey } = generateKeyPair();
  ok("Test 1: Claves generadas (PEM no vacías)", privateKey.length > 100 && publicKey.length > 100);

  // Inyectar en process.env para que el resto del módulo las use
  process.env.RSA_PRIVATE_KEY_PEM = privateKey.trim().replace(/\r?\n/g, "\\n");
  process.env.RSA_PUBLIC_KEY_PEM  = publicKey.trim().replace(/\r?\n/g, "\\n");

  // ── Test 2: flujo completo (blind → sign → unblind) ──
  const token = generateVoteToken();
  const result = issueBlindSignedVoteToken(token);
  ok("Test 2: Token firmado ciegamente (encodedTokenFirmado no vacío)", result.encodedTokenFirmado.length > 10);
  ok("Test 2b: token == result.token", result.token === token);

  // ── Test 3: verificar firma válida ──
  const valid = verifyUnblindedToken(token, result.signatureDecimal);
  ok("Test 3: Verificación de firma válida retorna true", valid === true);

  // ── Test 4: verificar firma con token incorrecto ──
  const invalid = verifyUnblindedToken("token-falso-que-nunca-se-firmó", result.signatureDecimal);
  ok("Test 4: Verificación con token falso retorna false", invalid === false);

  // ── Test 5: dos emisiones del mismo token generan firmas distintas (factor ciego aleatorio) ──
  const blinded1 = blindVoteToken(token);
  const blinded2 = blindVoteToken(token);
  ok("Test 5: blindingFactor distinto en cada cegado (aleatorio)", blinded1.blindingFactor !== blinded2.blindingFactor);

  const signed1 = signBlindToken(blinded1.blindedToken);
  const signed2 = signBlindToken(blinded2.blindedToken);
  ok("Test 5b: firmas de tokens cegados distintas", signed1 !== signed2);

  const unblinded1 = unblindSignedToken(token, signed1, blinded1.blindingFactor);
  const unblinded2 = unblindSignedToken(token, signed2, blinded2.blindingFactor);
  ok("Test 5c: firmas desenmascaradas distintas", unblinded1.signatureDecimal !== unblinded2.signatureDecimal);

  // ── Test extra: la clave pública expone fingerprint (requerido por contrato) ──
  const pubKey = getBlindSignaturePublicKey();
  ok("Test extra: fingerprint SHA-256 de 64 chars", pubKey.fingerprint.length === 64);
  ok("Test extra: modulusLengthBytes == 256 (RSA-2048)", pubKey.modulusLengthBytes === 256);

  console.log(`\nResultado: ${passed} pasaron, ${failed} fallaron`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
