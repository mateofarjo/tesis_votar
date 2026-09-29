// Linea base de azar para el ataque de correlacion temporal.
//
// Con las marcas de tiempo cubeteadas, todas las entradas de una cubeta
// comparten instante y el adversario no puede ordenarlas: lo mejor que puede
// hacer es emparejar al azar dentro de cada cubeta. Este script estima por
// simulacion cuantos aciertos obtendria asi, para poder decir si el resultado
// medido del ataque es o no distinguible del azar.
const { Client } = require('pg');

const ENSAYOS = 100000;

(async () => {
  const db = new Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:5433/votar' });
  await db.connect();

  const cubetas = (await db.query(`
    SELECT created_at, count(*)::int AS n
    FROM audit_logs WHERE action = 'TOKEN_GENERADO'
    GROUP BY created_at ORDER BY created_at`)).rows;

  const total = cubetas.reduce((s, c) => s + c.n, 0);
  console.log(`cubetas: ${cubetas.map((c) => c.n).join(', ')}   votantes: ${total}\n`);

  // Un emparejamiento al azar dentro de una cubeta de n elementos acierta tantas
  // veces como puntos fijos tenga una permutacion aleatoria de n: en promedio 1,
  // sea cual sea n. Se simula para obtener tambien la dispersion.
  const histograma = new Map();
  let suma = 0;
  for (let ensayo = 0; ensayo < ENSAYOS; ensayo += 1) {
    let aciertos = 0;
    for (const { n } of cubetas) {
      const perm = Array.from({ length: n }, (_, i) => i);
      for (let i = n - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [perm[i], perm[j]] = [perm[j], perm[i]];
      }
      aciertos += perm.filter((v, i) => v === i).length;
    }
    suma += aciertos;
    histograma.set(aciertos, (histograma.get(aciertos) ?? 0) + 1);
  }

  const medida = Number.parseInt(process.argv[2] ?? '', 10);
  console.log(`aciertos esperados al azar: ${(suma / ENSAYOS).toFixed(2)} de ${total}` +
              `  (${((suma / ENSAYOS / total) * 100).toFixed(1)} %)`);

  const claves = [...histograma.keys()].sort((a, b) => a - b);
  console.log('\n  aciertos   probabilidad');
  for (const k of claves) {
    const p = histograma.get(k) / ENSAYOS;
    if (p < 0.001) continue;
    console.log(`     ${String(k).padStart(2)}       ${(p * 100).toFixed(1).padStart(5)} %  ${'#'.repeat(Math.round(p * 60))}`);
  }

  if (Number.isFinite(medida)) {
    let alMenos = 0;
    for (const k of claves) if (k >= medida) alMenos += histograma.get(k);
    const p = alMenos / ENSAYOS;
    console.log(`\n  el ataque obtuvo ${medida}; al azar se obtiene ${medida} o mas con probabilidad ${(p * 100).toFixed(1)} %`);
    console.log(p > 0.05
      ? '  => el resultado NO es distinguible del azar'
      : '  => el resultado excede lo esperable por azar');
  }

  const solas = cubetas.filter((c) => c.n === 1).length;
  if (solas > 0) {
    console.log(`\n  ADVERTENCIA: ${solas} cubeta(s) contienen un unico votante.`);
    console.log('  El cubeteado no aporta nada alli: quien vota solo en su ventana queda');
    console.log('  identificado con certeza. La proteccion depende de la concurrencia.');
  }

  await db.end();
})();
