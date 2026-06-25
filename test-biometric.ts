// test-biometric.ts — adaptado a la API real de lib/biometricHash.ts
import { compareSha256Hashes, hashBiometricVector, hashDni, hashIpAddress } from "./lib/biometricHash";

async function main() {
  let passed = 0;
  let failed = 0;

  function ok(label: string, condition: boolean) {
    if (condition) { console.log(`✓ ${label}`); passed++; }
    else           { console.log(`✗ ${label}`); failed++; }
  }

  const vectoresFaciales = [0.234, 0.891, 0.112, 0.445, 0.778];

  // Test 1: genera un hash
  const hash1 = hashBiometricVector(vectoresFaciales);
  console.log("  Hash generado:", hash1);
  ok("Test 1: Hash generado (no vacío)", hash1.length > 0);
  ok("Test 1b: Longitud SHA-256 = 64 chars", hash1.length === 64);

  // Test 2: el mismo input siempre da el mismo hash (determinista)
  const hash2 = hashBiometricVector(vectoresFaciales);
  ok("Test 2: Es determinista (hash1 === hash2)", hash1 === hash2);

  // Test 3: vectores distintos dan hashes distintos
  const otrosVectores = [0.111, 0.222, 0.333, 0.444, 0.555];
  const hash3 = hashBiometricVector(otrosVectores);
  ok("Test 3: Hashes distintos para distintos vectores", hash1 !== hash3);

  // Test 4: no existe función de decodificación (one-way)
  const mod = require("./lib/biometricHash") as Record<string, unknown>;
  ok("Test 4: Sin función decodeHash (one-way)", typeof mod["decodeHash"] === "undefined");

  // Test extra 1: hashDni normaliza y hashea
  const dniHash = hashDni("30.111.222");
  const dniHash2 = hashDni("30111222");
  ok("Test extra 1: hashDni normaliza puntos (equivalente)", dniHash === dniHash2);
  ok("Test extra 1b: hashDni produce SHA-256 de 64 chars", dniHash.length === 64);

  // Test extra 2: compareSha256Hashes (timing-safe)
  ok("Test extra 2: compareSha256Hashes iguales retorna true", compareSha256Hashes(hash1, hash1));
  ok("Test extra 2b: compareSha256Hashes distintos retorna false", !compareSha256Hashes(hash1, hash3));

  // Test extra 3: hashIpAddress
  const ipHash = hashIpAddress("192.168.1.1");
  ok("Test extra 3: hashIpAddress produce 64 chars", ipHash.length === 64);

  // Test extra 4: objeto anidado (payload biométrico real de Veriff)
  const complexVector = { confidence: 0.97, landmarks: [0.1, 0.2], version: "v2" };
  const hashObj = hashBiometricVector(complexVector);
  ok("Test extra 4: hashea objetos anidados", hashObj.length === 64);
  ok("Test extra 4b: objeto anidado es determinista", hashObj === hashBiometricVector(complexVector));

  console.log(`\nResultado: ${passed} pasaron, ${failed} fallaron`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
