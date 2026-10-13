import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * La URL se toma del entorno y no se escribe aqui, de modo que el esquema no
 * quede atado a ninguna base en particular.
 *
 * Deliberadamente no se falla cuando la variable no esta definida: `prisma
 * generate` solo necesita el esquema, y hacerlo fallar impediria compilar la
 * aplicacion en entornos que no tienen —ni necesitan— acceso a la base. Los
 * comandos que si la requieren, como `migrate deploy`, la verifican por su
 * cuenta en `scripts/verificar-database-url.js`.
 */
export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL
  },
  migrations: {
    path: "prisma/migrations"
  },
  schema: "prisma/schema.prisma"
});
