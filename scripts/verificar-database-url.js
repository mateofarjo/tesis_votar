#!/usr/bin/env node
'use strict';
require('dotenv/config');

/**
 * Comprobacion previa a los comandos de Prisma que tocan la base.
 *
 * Prisma, ante una URL ausente, informa que "the datasource.url property is
 * required in your Prisma config file": apunta al archivo de configuracion, que
 * esta bien, en lugar de a la variable de entorno que falta, que es lo que hay
 * que corregir. Este mensaje nombra la causa.
 */
const url = (process.env.DATABASE_URL || '').trim();

if (!url) {
  console.error('\nFalta DATABASE_URL.\n');
  console.error('  En local      : definila en .env o .env.local');
  console.error('  En Vercel     : Settings > Environment Variables, para cada entorno que la use');
  console.error('  En CI         : como secreto del flujo de trabajo\n');
  console.error('Sin esa variable, Prisma no sabe contra que base aplicar las migraciones.\n');
  process.exit(1);
}

if (!/^postgres(ql)?:\/\//.test(url)) {
  console.error('\nDATABASE_URL no parece una cadena de conexion de PostgreSQL.\n');
  process.exit(1);
}
