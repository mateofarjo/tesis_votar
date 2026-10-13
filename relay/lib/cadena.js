'use strict';
const { ethers } = require('ethers');
const fs = require('node:fs');
const path = require('node:path');

let proveedor = null;
let contrato = null;
let clavePublica = null;

function getProveedor() {
  if (proveedor) return proveedor;
  const url = (process.env.RELAY_RPC_URL || '').trim();
  if (!url) throw new Error('Falta RELAY_RPC_URL');
  const esLocal = /127\.0\.0\.1|localhost|0\.0\.0\.0/.test(url);
  proveedor = new ethers.JsonRpcProvider(url, esLocal ? undefined : undefined);
  return proveedor;
}

function getContrato() {
  if (contrato) return contrato;
  const direccion = (process.env.RELAY_CONTRACT_ADDRESS || '').trim();
  const clave = (process.env.RELAY_PRIVATE_KEY || '').trim();
  if (!direccion) throw new Error('Falta RELAY_CONTRACT_ADDRESS');
  if (!clave) throw new Error('Falta RELAY_PRIVATE_KEY');

  const abi = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'abi', 'VotacionContract.json'), 'utf8')
  ).abi;

  // NonceManager: los envios se serializan desde la cola, pero una reversion no
  // debe dejar un hueco en la numeracion de transacciones.
  const billetera = new ethers.NonceManager(new ethers.Wallet(clave, getProveedor()));
  contrato = new ethers.Contract(direccion, abi, billetera);
  return contrato;
}

/**
 * Clave publica de la autoridad, leida del propio contrato.
 *
 * No se toma de una variable de entorno a proposito: la que importa es la que el
 * contrato va a usar para verificar, y leerla de alli elimina la posibilidad de
 * que este servicio acepte credenciales que la urna rechazaria, o al reves.
 */
async function getClavePublicaAutoridad() {
  if (clavePublica) return clavePublica;
  const codificada = await getContrato().clavePublicaAutoridad();
  const [moduloHex, exponenteHex] = ethers.AbiCoder.defaultAbiCoder()
    .decode(['bytes', 'bytes'], codificada);
  clavePublica = { exponente: BigInt(exponenteHex), modulo: BigInt(moduloHex) };
  return clavePublica;
}

/** Llamada estatica: reproduce la transaccion sin enviarla ni gastar gas. */
async function simularVoto(tokenFirmado, candidatoId) {
  await getContrato().emitirVoto.staticCall(tokenFirmado, candidatoId);
}

async function enviarVoto(tokenFirmado, candidatoId) {
  const tx = await getContrato().emitirVoto(tokenFirmado, candidatoId);
  return tx.wait();
}

function getDireccionContrato() {
  return (process.env.RELAY_CONTRACT_ADDRESS || '').trim();
}

module.exports = {
  enviarVoto,
  getClavePublicaAutoridad,
  getDireccionContrato,
  simularVoto
};
