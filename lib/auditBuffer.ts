import { randomInt } from "node:crypto";

import type { Prisma } from "@prisma/client";

import prisma from "./prisma";

/**
 * Escritura diferida y barajada de las entradas cubeteadas de la traza.
 *
 * Truncar la marca temporal iguala el instante de todas las entradas de una
 * cubeta, pero no basta: al consultar con `ORDER BY created_at`, PostgreSQL
 * devuelve los empates en orden fisico de las filas, que reproduce el orden de
 * insercion. Una medicion sobre el sistema con solo el cubeteado aplicado
 * recupero 6 de 9 vinculaciones por esa via.
 *
 * Las entradas cubeteadas se acumulan por eso en memoria y se escriben **todas
 * juntas, en orden aleatorio**, al cerrarse la ventana. Dentro de una ventana
 * deja de existir orden legible, ni por fecha, ni por identificador, ni fisico.
 *
 * El costo debe enunciarse: una entrada puede tardar hasta una ventana completa
 * en aparecer en la base, y las que esten en el buffer se pierden si el proceso
 * termina de manera abrupta. Es un intercambio deliberado entre inmediatez de la
 * traza y secreto del voto, y se resuelve a favor del segundo. Para un despliegue
 * real corresponde persistir el buffer en una cola durable.
 */

type EntradaDiferida = Prisma.AuditLogCreateManyInput;

const globalParaBuffer = globalThis as typeof globalThis & {
  auditBuffer?: EntradaDiferida[];
  auditBufferTimer?: NodeJS.Timeout | null;
};

const buffer: EntradaDiferida[] = globalParaBuffer.auditBuffer ?? [];
if (!globalParaBuffer.auditBuffer) {
  globalParaBuffer.auditBuffer = buffer;
}

/**
 * Tiempo que resta hasta el cierre de la cubeta en curso.
 *
 * El vaciado se alinea con la cubeta y no con un plazo fijo desde la primera
 * entrada: de ese modo cada lote contiene exactamente las entradas que comparten
 * marca temporal, que son precisamente aquellas entre las que no debe quedar
 * orden legible. Un plazo fijo mas corto que la cubeta dejaria sublotes
 * ordenados entre si.
 *
 * AUDIT_FLUSH_WINDOW_MS permite forzar un plazo fijo; se usa en pruebas.
 */
function ventanaMs(): number {
  const forzada = Number.parseInt(process.env.AUDIT_FLUSH_WINDOW_MS ?? "", 10);
  if (Number.isFinite(forzada) && forzada >= 0) {
    return forzada;
  }

  const minutos = Number.parseInt(process.env.AUDIT_TIME_BUCKET_MINUTES ?? "15", 10);
  const cubetaMs = (Number.isFinite(minutos) && minutos > 0 ? minutos : 15) * 60_000;
  const restante = cubetaMs - (Date.now() % cubetaMs);
  // Un margen minimo evita vaciados degenerados justo sobre el borde.
  return Math.max(restante, 1_000);
}

function barajar<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export async function vaciarBufferDeAuditoria(): Promise<number> {
  if (globalParaBuffer.auditBufferTimer) {
    clearTimeout(globalParaBuffer.auditBufferTimer);
    globalParaBuffer.auditBufferTimer = null;
  }

  const pendientes = buffer.splice(0, buffer.length);
  if (pendientes.length === 0) {
    return 0;
  }

  try {
    await prisma.auditLog.createMany({ data: barajar(pendientes) });
    return pendientes.length;
  } catch (error) {
    console.error("No se pudo vaciar el buffer de auditoria", error);
    return 0;
  }
}

export function encolarEntradaDiferida(entrada: EntradaDiferida): void {
  buffer.push(entrada);

  if (ventanaMs() === 0) {
    void vaciarBufferDeAuditoria();
    return;
  }

  if (!globalParaBuffer.auditBufferTimer) {
    globalParaBuffer.auditBufferTimer = setTimeout(() => {
      globalParaBuffer.auditBufferTimer = null;
      void vaciarBufferDeAuditoria();
    }, ventanaMs());
    globalParaBuffer.auditBufferTimer.unref?.();
  }
}

/** Solo para pruebas y diagnostico. */
export function pendientesEnBuffer(): number {
  return buffer.length;
}
