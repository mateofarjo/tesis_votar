'use strict';
require('dotenv').config({ path: process.env.RELAY_ENV_FILE || '.env' });

const http = require('node:http');
const { ethers } = require('ethers');

const { esCredencialValida } = require('./lib/credencial');
const { getClavePublicaAutoridad, getDireccionContrato, simularVoto } = require('./lib/cadena');
const { encolarVoto } = require('./lib/cola');
const { registrar, vaciarBuffer } = require('./lib/auditoria');

/**
 * Servicio de sufragio de Vot.Ar.
 *
 * Se despliega por separado del servicio de identidad. El navegador del votante
 * lo alcanza **directamente**, sin pasar por aquel: si el servicio de identidad
 * actuara de intermediario, volveria a ver las dos puntas —quien pidio la
 * credencial y cuando se emitio el voto— y la separacion no significaria nada.
 *
 * Lo que este servicio conoce:
 *   - la clave publica de la autoridad, leida del contrato;
 *   - la clave de la billetera que paga el gas;
 *   - su propia traza de auditoria, sin identificadores.
 *
 * Lo que no conoce, y no puede averiguar:
 *   - el padron;
 *   - la sesion del votante;
 *   - la clave privada con la que se firman las credenciales.
 */

const ORIGENES = (process.env.RELAY_ALLOWED_ORIGINS || '')
  .split(',').map((o) => o.trim()).filter(Boolean);

function cabecerasCors(req, res) {
  const origen = req.headers.origin;
  if (origen && (ORIGENES.includes(origen) || ORIGENES.includes('*'))) {
    res.setHeader('Access-Control-Allow-Origin', origen);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Sin credenciales: este servicio no acepta cookies ni cabeceras de sesion, de
  // modo que el navegador no puede adjuntar la identidad del votante ni por error.
  res.setHeader('Access-Control-Allow-Credentials', 'false');
}

function responder(res, codigo, cuerpo) {
  const json = JSON.stringify(cuerpo);
  res.writeHead(codigo, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' });
  res.end(json);
}

function leerCuerpo(req, limiteBytes = 16 * 1024) {
  return new Promise((resolver, rechazar) => {
    let total = 0;
    const partes = [];
    req.on('data', (c) => {
      total += c.length;
      if (total > limiteBytes) { rechazar(new Error('Cuerpo demasiado grande')); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => resolver(Buffer.concat(partes).toString('utf8')));
    req.on('error', rechazar);
  });
}

const abiCoder = ethers.AbiCoder.defaultAbiCoder();

function decodificarCredencial(tokenFirmado) {
  const [tokenHex, firmaHex] = abiCoder.decode(['bytes', 'bytes'], tokenFirmado);
  return { firmaHex, tokenHex };
}

async function manejarVoto(req, res) {
  let cuerpo;
  try {
    cuerpo = JSON.parse(await leerCuerpo(req));
  } catch {
    return responder(res, 400, { error: 'El cuerpo JSON es invalido' });
  }

  const tokenFirmado = typeof cuerpo.tokenFirmado === 'string' ? cuerpo.tokenFirmado.trim() : '';
  const candidatoId = Number.isInteger(cuerpo.candidatoId) ? cuerpo.candidatoId : Number.NaN;

  if (!tokenFirmado || !Number.isInteger(candidatoId) || candidatoId < 0 || candidatoId > 255) {
    return responder(res, 400, { error: 'tokenFirmado y candidatoId son obligatorios' });
  }

  let credencial;
  try {
    credencial = decodificarCredencial(tokenFirmado);
  } catch {
    return responder(res, 400, { error: 'El tokenFirmado no tiene un formato ABI valido' });
  }

  // El gas lo paga este servicio: una credencial sin firma valida de la autoridad
  // se descarta aqui, antes de que cueste nada.
  const { exponente, modulo } = await getClavePublicaAutoridad();
  if (!esCredencialValida({ candidatoId, exponente, firmaHex: credencial.firmaHex, modulo, tokenHex: credencial.tokenHex })) {
    return responder(res, 400, { error: 'La credencial no lleva una firma valida de la autoridad electoral' });
  }

  // Simulacion previa: reproduce la transaccion sin enviarla, de modo que una
  // credencial ya consumida o una urna cerrada no consuman gas.
  try {
    await simularVoto(tokenFirmado, candidatoId);
  } catch (error) {
    const motivo = error.reason || error.shortMessage || 'La transaccion no procede';
    return responder(res, 409, { error: 'No se pudo emitir el voto', details: motivo });
  }

  registrar('VOTO_RECIBIDO');

  try {
    const receipt = await encolarVoto(tokenFirmado, candidatoId);
    if (!receipt) throw new Error('La transaccion no devolvio receipt');

    registrar('VOTO_CONFIRMADO', { bloque: receipt.blockNumber, txHash: receipt.hash });

    return responder(res, 200, {
      blockNumber: receipt.blockNumber,
      contractAddress: getDireccionContrato(),
      transactionHash: receipt.hash
    });
  } catch (error) {
    console.error('No se pudo emitir el voto en blockchain', error);
    const motivo = error.reason || error.shortMessage || String(error.message || error);
    return responder(res, 502, { error: 'No se pudo emitir el voto', details: motivo });
  }
}

const servidor = http.createServer(async (req, res) => {
  cabecerasCors(req, res);

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (req.method === 'GET' && req.url === '/salud') {
    return responder(res, 200, { contrato: getDireccionContrato(), servicio: 'votar-relay' });
  }

  if (req.method === 'POST' && req.url === '/voto') {
    try {
      return await manejarVoto(req, res);
    } catch (error) {
      console.error('Fallo inesperado en el endpoint de voto', error);
      return responder(res, 500, { error: 'Fallo inesperado' });
    }
  }

  return responder(res, 404, { error: 'No encontrado' });
});

const PUERTO = Number.parseInt(process.env.RELAY_PORT || '3100', 10);
servidor.listen(PUERTO, () => {
  console.log(`[votar-relay] escuchando en ${PUERTO}`);
  console.log(`[votar-relay] contrato ${getDireccionContrato()}`);
});

for (const senal of ['SIGINT', 'SIGTERM']) {
  process.on(senal, async () => {
    // Vaciar el buffer antes de salir: lo pendiente se perderia de otro modo.
    await vaciarBuffer();
    servidor.close(() => process.exit(0));
  });
}
