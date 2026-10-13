import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * La URL se toma del entorno y no se escribe aqui, de modo que el esquema no
 * quede atado a ninguna base en particular.
 *
 * Si falta, se falla con un mensaje que nombra la causa. El error que Prisma
 * emite por su cuenta —"The datasource.url property is required in your Prisma
 * config file"— apunta a este archivo y no a la variable ausente, que es lo que
 * en realidad hay que corregir.
 */
const url = process.env.DATABASE_URL?.trim();

if (!url) {
  throw new Error(
    "Falta DATABASE_URL. Definila en el entorno (en Vercel, en Settings > Environment Variables, " +
      "para los entornos en los que vaya a usarse) antes de ejecutar comandos de Prisma."
  );
}

export default defineConfig({
  datasource: {
    url
  },
  migrations: {
    path: "prisma/migrations"
  },
  schema: "prisma/schema.prisma"
});
