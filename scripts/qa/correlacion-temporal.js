// Ataque de correlación temporal: intenta vincular votante con voto usando
// únicamente lo que un operador con acceso a la base podría leer.
const { createHash } = require('node:crypto');
const { Client } = require('pg');
const fs = require('fs');

const hashDni = d => createHash('sha256').update(d.replace(/\D/g,''),'utf8').digest('hex');

(async()=>{
  const db = new Client({connectionString:'postgresql://postgres:postgres@127.0.0.1:5433/votar'});
  await db.connect();

  // --- lo que ve el atacante ---
  const emisiones = (await db.query(
    `SELECT voter_id, created_at FROM audit_logs
     WHERE action='TOKEN_GENERADO' ORDER BY created_at`)).rows;
  const confirmaciones = (await db.query(
    `SELECT metadata->>'blockchainTxHash' AS tx, created_at FROM audit_logs
     WHERE action='VOTO_CONFIRMADO' ORDER BY created_at`)).rows;

  console.log(`emisiones de credencial: ${emisiones.length}   votos confirmados: ${confirmaciones.length}\n`);

  // --- heurística del atacante: a cada emisión, la confirmación siguiente más próxima ---
  const usadas = new Set();
  const inferido = [];
  for (const e of emisiones) {
    let mejor=null, dt=Infinity;
    confirmaciones.forEach((c,i)=>{
      if (usadas.has(i)) return;
      const d = new Date(c.created_at) - new Date(e.created_at);
      if (d >= 0 && d < dt) { dt = d; mejor = i; }
    });
    if (mejor!==null) { usadas.add(mejor); inferido.push({voter:e.voter_id, tx:confirmaciones[mejor].tx, seg:(dt/1000).toFixed(1)}); }
  }

  // --- verdad de referencia ---
  const real = JSON.parse(fs.readFileSync('/tmp/eleccion.json','utf8'));
  const porHash = {};
  for (const r of real.res) porHash[hashDni(r.dni)] = {tx:r.tx, cand:r.cand};
  const voters = (await db.query('SELECT id, dni_hash FROM voters')).rows;
  const idAHash = {}; voters.forEach(v=>idAHash[v.id]=v.dni_hash);

  let aciertos=0;
  console.log('  votante          tx inferida        Δt(s)   ¿correcta?');
  for (const inf of inferido) {
    const h = idAHash[inf.voter];
    const verdad = porHash[h];
    const ok = verdad && verdad.tx === inf.tx;
    if (ok) aciertos++;
    console.log(`  ${inf.voter.slice(0,10)}…  ${String(inf.tx).slice(0,14)}…  ${String(inf.seg).padStart(5)}    ${ok?'SÍ':'no'}`);
  }
  const pct = (aciertos*100/inferido.length).toFixed(1);
  console.log(`\n  aciertos: ${aciertos}/${inferido.length}  (${pct} %)`);
  console.log(`  ${aciertos===inferido.length ? 'LA CORRELACIÓN RECONSTRUYE EL PADRÓN COMPLETO' : 'reconstrucción parcial'}`);

  // separación temporal entre votos consecutivos
  const gaps=[];
  for(let i=1;i<confirmaciones.length;i++)
    gaps.push((new Date(confirmaciones[i].created_at)-new Date(confirmaciones[i-1].created_at))/1000);
  console.log(`  separación entre votos consecutivos: mín ${Math.min(...gaps).toFixed(1)} s, máx ${Math.max(...gaps).toFixed(1)} s`);
  await db.end();
})();
