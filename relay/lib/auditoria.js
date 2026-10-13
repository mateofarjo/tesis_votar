'use strict';
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

/**
 * Traza de auditoria **propia** del servicio de sufragio.
 *
 * Vive en una base distinta de la del padron, y esa es la razon de ser de todo
 * este servicio. Mientras ambas trazas compartian base, un operador con acceso
 * de lectura podia ordenar las emisiones de credencial junto a las
 * confirmaciones de voto y emparejarlas. Separadas, el mismo ataque exige el
 * concurso de dos operadores con accesos distintos.
 *
 * Aqui no hay identificador de votante, ni de credencial, ni direccion de red, ni
 * agente de usuario: no porque se omitan al escribir, sino porque este servicio
 * nunca llega a conocerlos.
 */
let pool = null;

function getPool() {
  if (pool) return pool;
  const connectionString = (process.env.RELAY_DATABASE_URL || '').trim();
  if (!connectionString) throw new Error('Falta RELAY_DATABASE_URL');
  pool = new Pool({ connectionString, max: 4 });
  return pool;
}

function minutosDeCubeta() {
  const bruto = Number.parseInt(process.env.RELAY_TIME_BUCKET_MINUTES || '', 10);
  if (!Number.isFinite(bruto) || bruto <= 0) return 15;
  return Math.min(bruto, 24 * 60);
}

/** Trunca el instante al inicio de su cubeta: dentro de una, no hay orden legible. */
function instanteCubeteado(ahora = new Date()) {
  const cubetaMs = minutosDeCubeta() * 60000;
  return new Date(Math.floor(ahora.getTime() / cubetaMs) * cubetaMs);
}

const buffer = [];
let temporizador = null;

function msHastaCierreDeCubeta() {
  const cubetaMs = minutosDeCubeta() * 60000;
  return Math.max(cubetaMs - (Date.now() % cubetaMs), 1000);
}

function barajar(items) {
  const { randomInt } = require('node:crypto');
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

async function vaciarBuffer() {
  if (temporizador) { clearTimeout(temporizador); temporizador = null; }
  const pendientes = buffer.splice(0, buffer.length);
  if (pendientes.length === 0) return 0;
  try {
    const filas = barajar(pendientes);
    const valores = [];
    const marcadores = filas.map((f, i) => {
      valores.push(f.id, f.accion, f.txHash, f.bloque, f.creadoEn);
      const b = i * 5;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`;
    });
    await getPool().query(
      `INSERT INTO relay_audit_logs (id, accion, tx_hash, bloque, creado_en) VALUES ${marcadores.join(', ')}`,
      valores
    );
    return filas.length;
  } catch (error) {
    console.error('No se pudo vaciar el buffer de auditoria del relay', error);
    return 0;
  }
}

/**
 * Las entradas se acumulan y se insertan en lote barajado al cerrar la cubeta.
 * Escribirlas al vuelo conservaria el orden fisico de las filas, que es orden de
 * insercion y por tanto orden de los votantes.
 */
function registrar(accion, { txHash = null, bloque = null } = {}) {
  buffer.push({
    accion,
    bloque,
    creadoEn: instanteCubeteado(),
    id: randomUUID(),
    txHash
  });
  if (!temporizador) {
    temporizador = setTimeout(() => { temporizador = null; void vaciarBuffer(); }, msHastaCierreDeCubeta());
    if (temporizador.unref) temporizador.unref();
  }
}

/**
 * Crea la tabla de auditoria si no existe.
 *
 * La migracion es idempotente (CREATE TABLE IF NOT EXISTS), de modo que correrla
 * en cada arranque es seguro y evita un paso manual al desplegar. Para un
 * esquema que creciera conviene una herramienta de migraciones; para una sola
 * tabla, esto es menos fragil que recordar ejecutarla.
 */
async function prepararEsquema() {
  const sql = readFileSync(path.join(__dirname, '..', 'migrations', '001_init.sql'), 'utf8');
  await getPool().query(sql);
}

module.exports = { getPool, instanteCubeteado, prepararEsquema, registrar, vaciarBuffer };
