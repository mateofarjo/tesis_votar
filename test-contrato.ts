// test-contrato.ts — Módulo 6: Smart Contract local (adaptado a la API real de lib/ethers.ts)
// Requiere: Hardhat node corriendo + contrato desplegado + .env.local con CONTRACT_ADDRESS

import { config } from "dotenv";
config({ path: ".env.local" });

import {
  abrirUrna,
  cerrarUrna,
  emitirVotoEnContrato,
  getEstadoActualUrna,
  getResultadosContrato,
  getTotalVotosEmitidos
} from "./lib/ethers";
import {
  issueBlindSignedVoteToken
} from "./lib/blindSignature";

async function main() {
  let passed = 0;
  let failed = 0;

  function ok(label: string, condition: boolean) {
    if (condition) { console.log(`  ✓ ${label}`); passed++; }
    else           { console.log(`  ✗ ${label}`); failed++; }
  }

  // Usamos las claves RSA de .env.local (las mismas con que se desplegó el contrato)

  // ── TEST 1: Leer estado actual del contrato ─────────────────────────────────
  console.log("\n[Test 1] Estado actual del contrato");
  const estadoInicial = await getEstadoActualUrna();
  console.log(`  Estado actual: ${estadoInicial}`);
  ok("Contrato accesible (estado leído)", estadoInicial === "CERRADA" || estadoInicial === "ABIERTA" || estadoInicial === "FINALIZADA");

  // ── TEST 2: Asegurar que la urna está ABIERTA (abrir si es necesario) ────────
  console.log("\n[Test 2] Urna ABIERTA");
  let estadoAbierto: string = estadoInicial;
  if (estadoInicial === "CERRADA") {
    const receiptAbrir = await abrirUrna();
    ok("Receipt de abrirUrna no es null", receiptAbrir !== null);
    console.log(`  TX hash: ${receiptAbrir?.hash ?? "N/A"}`);
    console.log(`  Block:   ${receiptAbrir?.blockNumber ?? "N/A"}`);
    estadoAbierto = await getEstadoActualUrna();
  } else {
    console.log(`  Urna ya estaba ${estadoInicial} — abrirUrna omitida`);
  }
  ok("Estado es ABIERTA para votar", estadoAbierto === "ABIERTA");

  // ── TEST 3: Emitir voto con token válido ─────────────────────────────────────
  console.log("\n[Test 3] Emitir voto");
  const tokenResult = issueBlindSignedVoteToken();
  const tokenFirmado = tokenResult.encodedTokenFirmado;
  console.log(`  Token digest: ${tokenResult.tokenDigestHex}`);

  const receiptVoto = await emitirVotoEnContrato({ candidatoId: 1, tokenFirmado });
  ok("Receipt de emitirVoto no es null", receiptVoto !== null);
  console.log(`  TX hash: ${receiptVoto?.hash ?? "N/A"}`);
  console.log(`  Block:   ${receiptVoto?.blockNumber ?? "N/A"}`);

  const totalTras1Voto = await getTotalVotosEmitidos();
  ok("Total votos = 1 tras primer voto", totalTras1Voto === 1);

  // ── TEST 4: Token duplicado debe ser rechazado ───────────────────────────────
  console.log("\n[Test 4] Token duplicado rechazado");
  let dobleVotoRechazado = false;
  try {
    await emitirVotoEnContrato({ candidatoId: 1, tokenFirmado });
    console.log("  ✗ ERROR: debería haber rechazado el token duplicado");
    failed++;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`  Error capturado: ${msg.slice(0, 80)}`);
    dobleVotoRechazado = true;
    ok("Token duplicado rechazado con excepción", true);
  }

  // ── TEST 5: Candidato inválido debe ser rechazado ────────────────────────────
  console.log("\n[Test 5] Candidato inválido");
  const token2 = issueBlindSignedVoteToken();
  let candidatoInvalidoRechazado = false;
  try {
    await emitirVotoEnContrato({ candidatoId: 99, tokenFirmado: token2.encodedTokenFirmado });
    console.log("  ✗ ERROR: debería haber rechazado candidato inválido");
    failed++;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`  Error capturado: ${msg.slice(0, 80)}`);
    candidatoInvalidoRechazado = true;
    ok("Candidato inválido rechazado con excepción", true);
  }

  // ── TEST 6: Obtener resultados ───────────────────────────────────────────────
  console.log("\n[Test 6] Obtener resultados");
  const resultados = await getResultadosContrato();
  ok("Array de resultados no vacío", resultados.length > 0);
  console.log(`  Candidatos: ${resultados.map(c => `${c.nombre}=${c.votos}`).join(", ")}`);
  // candidatoId=1 → "Lista B" (índice base-0)
  const listaB = resultados.find(c => c.nombre === "Lista B");
  ok("Lista B tiene 1 voto (candidatoId=1)", listaB?.votos === 1);
  const totalVotos = await getTotalVotosEmitidos();
  ok("Total votos coincide con voto emitido", totalVotos === 1);

  // ── TEST 7: Cerrar urna ──────────────────────────────────────────────────────
  console.log("\n[Test 7] Cerrar urna");
  const receiptCerrar = await cerrarUrna();
  ok("Receipt de cerrarUrna no es null", receiptCerrar !== null);
  console.log(`  TX hash: ${receiptCerrar?.hash ?? "N/A"}`);

  const estadoCerrado = await getEstadoActualUrna();
  ok("Estado tras cerrarUrna es FINALIZADA", estadoCerrado === "FINALIZADA");

  // ── TEST 8: No se puede votar con urna cerrada ───────────────────────────────
  console.log("\n[Test 8] Voto bloqueado con urna FINALIZADA");
  const token3 = issueBlindSignedVoteToken();
  try {
    await emitirVotoEnContrato({ candidatoId: 1, tokenFirmado: token3.encodedTokenFirmado });
    console.log("  ✗ ERROR: debería haber rechazado voto con urna cerrada");
    failed++;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`  Error capturado: ${msg.slice(0, 80)}`);
    ok("Voto bloqueado cuando urna está FINALIZADA", true);
  }

  // ── Resumen ──────────────────────────────────────────────────────────────────
  console.log(`\nResultado: ${passed} pasaron, ${failed} fallaron`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error("ERROR FATAL:", e.message); process.exit(1); });
