import { randomInt } from "node:crypto";

import { emitirVotoEnContrato, simularEmitirVoto, type EmitirVotoInput } from "./ethers";

import type { ContractTransactionReceipt } from "ethers";

/**
 * Cola de retransmision de sufragios.
 *
 * El proposito no es de rendimiento sino de privacidad. Si el retransmisor
 * envia cada voto en cuanto lo recibe, el orden de las transacciones en la
 * cadena reproduce el orden en que las personas votaron, y ese orden es
 * exactamente lo que un adversario necesita para emparejar cada sufragio con la
 * emision de credencial que lo precedio.
 *
 * Cada voto espera aqui una demora aleatoria dentro de una ventana; al vencer,
 * el despachador toma todos los que esten listos, los **baraja** y recien
 * entonces los envia. Dos sufragios que caen en la misma ventana salen a la
 * cadena en un orden que no guarda relacion con el de llegada.
 *
 * Limitacion que conviene enunciar: la medida solo aporta cuando hay
 * concurrencia. Si en toda la ventana llega un unico voto, el lote tiene un solo
 * elemento y no hay nada que barajar; lo unico que queda es la demora, que
 * desplaza el instante pero no rompe el orden. En una eleccion con votantes
 * espaciados, esta cola no sustituye al cubeteado de la traza de auditoria: lo
 * complementa.
 */

type Pendiente = {
  input: EmitirVotoInput;
  listoEn: number;
  rechazar: (error: unknown) => void;
  resolver: (receipt: ContractTransactionReceipt | null) => void;
};

const cola: Pendiente[] = [];
let despachando = false;
let temporizador: NodeJS.Timeout | null = null;

function ventanaMs(): number {
  const bruto = Number.parseInt(process.env.RELAY_BATCH_WINDOW_MS ?? "", 10);
  if (!Number.isFinite(bruto) || bruto < 0) {
    return 0;
  }
  return Math.min(bruto, 120_000);
}

function demoraAleatoria(): number {
  const ventana = ventanaMs();
  return ventana === 0 ? 0 : randomInt(0, ventana + 1);
}

/** Barajado de Fisher-Yates con la fuente de aleatoriedad criptografica. */
function barajar<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function programarDespacho(): void {
  if (temporizador || cola.length === 0) {
    return;
  }
  const proximo = Math.max(0, Math.min(...cola.map((p) => p.listoEn)) - Date.now());
  temporizador = setTimeout(() => {
    temporizador = null;
    void despachar();
  }, proximo);
}

async function despachar(): Promise<void> {
  if (despachando) {
    return;
  }
  despachando = true;

  try {
    const ahora = Date.now();
    const listos: Pendiente[] = [];
    for (let i = cola.length - 1; i >= 0; i -= 1) {
      if (cola[i].listoEn <= ahora) {
        listos.push(cola.splice(i, 1)[0]);
      }
    }

    for (const pendiente of barajar(listos)) {
      try {
        pendiente.resolver(await emitirVotoEnContrato(pendiente.input));
      } catch (error) {
        pendiente.rechazar(error);
      }
    }
  } finally {
    despachando = false;
    programarDespacho();
  }
}

/**
 * Encola un sufragio para su retransmision. La promesa se resuelve con el
 * receipt real, de modo que el votante sigue recibiendo su comprobante; lo que
 * cambia es el instante y el orden en que la transaccion llega a la cadena.
 *
 * Antes de encolar se simula la transaccion contra el nodo: una credencial
 * invalida se descarta aqui, sin consumir gas del retransmisor.
 */
export async function encolarVoto(
  input: EmitirVotoInput
): Promise<ContractTransactionReceipt | null> {
  await simularEmitirVoto(input);

  return new Promise<ContractTransactionReceipt | null>((resolver, rechazar) => {
    cola.push({ input, listoEn: Date.now() + demoraAleatoria(), rechazar, resolver });
    programarDespacho();
  });
}

/** Solo para pruebas: cantidad de sufragios esperando despacho. */
export function pendientesEnCola(): number {
  return cola.length;
}
