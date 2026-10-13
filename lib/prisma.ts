import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Cliente de Prisma de inicializacion perezosa.
 *
 * La version anterior leia DATABASE_URL y lanzaba al importarse el modulo. Eso
 * convertia la ausencia de la variable en un fallo de **compilacion**: durante la
 * fase de recoleccion de datos de pagina, Next carga cada modulo de ruta, de modo
 * que una ruta que importara este archivo rompia el build entero con un error que
 * no nombraba la ruta culpable.
 *
 * Compilar no requiere base de datos; atender una peticion si. El cliente se crea
 * por lo tanto en el primer uso, y la ausencia de la variable se manifiesta
 * entonces, donde corresponde y con el contexto de la peticion que la necesitaba.
 */
const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};

function crearCliente(): PrismaClient {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(
      "Falta DATABASE_URL en el entorno. La aplicacion necesita una base de datos para atender esta peticion."
    );
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"]
  });
}

function obtenerCliente(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = crearCliente();
  }
  return globalForPrisma.prisma;
}

/**
 * Se expone un proxy en lugar del cliente, de modo que los modulos que hacen
 * `import prisma from "./prisma"` sigan funcionando sin cambios: la conexion se
 * abre en el primer acceso a una propiedad, no al importar.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_destino, propiedad, receptor) {
    const cliente = obtenerCliente();
    const valor = Reflect.get(cliente as object, propiedad, receptor);
    return typeof valor === "function" ? valor.bind(cliente) : valor;
  },
  has(_destino, propiedad) {
    return Reflect.has(obtenerCliente() as object, propiedad);
  }
});

export default prisma;
