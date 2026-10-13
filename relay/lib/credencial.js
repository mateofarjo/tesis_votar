'use strict';
const { createHash } = require('node:crypto');

const DOMINIO = 'VOT.AR/VOTE-CREDENTIAL/v2';

/**
 * Verificacion de la credencial fuera de la cadena.
 *
 * Este modulo conoce unicamente la clave **publica** de la autoridad. Es una
 * propiedad deliberada del diseno y no una omision: el servicio de sufragio
 * puede comprobar que una credencial fue emitida por la autoridad, pero no puede
 * emitir ninguna. Si alguna vez necesitara la clave privada para funcionar,
 * la separacion entre los dos servicios habria dejado de significar algo.
 */
function digestoDeCredencial(tokenHex, candidatoId) {
  return BigInt('0x' + createHash('sha256')
    .update(DOMINIO, 'utf8')
    .update(Buffer.from(tokenHex.slice(2), 'hex'))
    .update(Buffer.from([candidatoId]))
    .digest('hex'));
}

function modPow(base, exponente, modulo) {
  let resultado = 1n;
  let b = base % modulo;
  let e = exponente;
  while (e > 0n) {
    if (e & 1n) resultado = (resultado * b) % modulo;
    e >>= 1n;
    b = (b * b) % modulo;
  }
  return resultado;
}

/**
 * Comprueba `s^e mod n == SHA-256(dominio || token || candidatoId)`.
 *
 * El gas lo paga este servicio y su endpoint no exige autenticacion, de modo que
 * sin esta comprobacion cualquiera podria agotar sus fondos enviando credenciales
 * invalidas. No sustituye la verificacion on-chain, que sigue siendo la que
 * decide; es la comprobacion previa del que paga.
 */
function esCredencialValida({ tokenHex, firmaHex, candidatoId, modulo, exponente }) {
  const token = String(tokenHex || '').trim().toLowerCase();
  const firma = String(firmaHex || '').trim().toLowerCase();

  if (!/^0x[0-9a-f]{64}$/.test(token)) return false;
  if (!/^0x[0-9a-f]{512}$/.test(firma)) return false;
  if (!Number.isInteger(candidatoId) || candidatoId < 0 || candidatoId > 255) return false;

  try {
    const s = BigInt(firma);
    if (s <= 0n || s >= modulo) return false;
    return modPow(s, exponente, modulo) === digestoDeCredencial(token, candidatoId);
  } catch {
    return false;
  }
}

module.exports = { DOMINIO, digestoDeCredencial, esCredencialValida };
