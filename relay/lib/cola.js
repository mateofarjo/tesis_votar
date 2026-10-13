'use strict';
const { randomInt } = require('node:crypto');
const { enviarVoto } = require('./cadena');

/**
 * Cola de retransmision con demora aleatoria y barajado del lote.
 *
 * Si el servicio enviara cada sufragio en cuanto lo recibe, el orden de las
 * transacciones en la cadena reproduciria el orden en que las personas votaron.
 * Cada voto espera aqui un tiempo aleatorio dentro de una ventana; al vencer, el
 * despachador toma los que esten listos, los baraja y recien entonces los envia.
 *
 * Limite que conviene no ocultar: solo aporta con concurrencia. Si en toda la
 * ventana llega un unico voto, el lote tiene un solo elemento y no hay nada que
 * barajar.
 */
const cola = [];
let despachando = false;
let temporizador = null;

function ventanaMs() {
  const bruto = Number.parseInt(process.env.RELAY_BATCH_WINDOW_MS || '', 10);
  if (!Number.isFinite(bruto) || bruto < 0) return 0;
  return Math.min(bruto, 120000);
}

function barajar(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function programar() {
  if (temporizador || cola.length === 0) return;
  const espera = Math.max(0, Math.min(...cola.map((p) => p.listoEn)) - Date.now());
  temporizador = setTimeout(() => { temporizador = null; void despachar(); }, espera);
  if (temporizador.unref) temporizador.unref();
}

async function despachar() {
  if (despachando) return;
  despachando = true;
  try {
    const ahora = Date.now();
    const listos = [];
    for (let i = cola.length - 1; i >= 0; i -= 1) {
      if (cola[i].listoEn <= ahora) listos.push(cola.splice(i, 1)[0]);
    }
    for (const p of barajar(listos)) {
      try { p.resolver(await enviarVoto(p.tokenFirmado, p.candidatoId)); }
      catch (error) { p.rechazar(error); }
    }
  } finally {
    despachando = false;
    programar();
  }
}

function encolarVoto(tokenFirmado, candidatoId) {
  const ventana = ventanaMs();
  return new Promise((resolver, rechazar) => {
    cola.push({
      candidatoId,
      listoEn: Date.now() + (ventana === 0 ? 0 : randomInt(0, ventana + 1)),
      rechazar,
      resolver,
      tokenFirmado
    });
    programar();
  });
}

module.exports = { encolarVoto, pendientes: () => cola.length };
