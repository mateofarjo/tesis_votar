import { config } from 'dotenv';
config({ path: '.env.local' });

const { PrismaPg } = await import('@prisma/adapter-pg');
const { PrismaClient } = await import('@prisma/client');
const pg = await import('pg');
const Pool = pg.default.Pool;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Correct dniHash: hashDni("TEST1781029117823") strips non-digits → sha256("1781029117823")
const correctDniHash = '6cf9251c74ab71364021fd441527152b53915a8255ef5b4f07a8053c263beabb';

const updated = await prisma.voter.update({
  where: { id: 'cmq6yr2lw0000m0u69x6xf97l' },
  data: { dniHash: correctDniHash }
});
console.log('Updated voter dniHash:', updated.dniHash);
await prisma.$disconnect();
await pool.end();
