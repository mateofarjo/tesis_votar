import { config } from 'dotenv';
config({ path: '.env.local' });

const { PrismaPg } = await import('@prisma/adapter-pg');
const { PrismaClient } = await import('@prisma/client');
const pg = await import('pg');
const Pool = pg.default.Pool;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const attempt = await prisma.verificationAttempt.create({
  data: {
    voterId: 'cmq6yr2lw0000m0u69x6xf97l',
    type: 'LIVENESS',
    status: 'APROBADO',
    biometricMatch: true,
    veriffSessionId: 'test-session-' + Date.now(),
    resolvedAt: new Date(),
    biometricHash: 'd92cdc5b4509d47d19f1750bcd1e52ad36e45bd8b36980d54cba7db3e2ff795e',
    dniHash: '6cf9251c74ab71364021fd441527152b53915a8255ef5b4f07a8053c263beabb'
  }
});
console.log('Created attempt:', attempt.id, 'status:', attempt.status, 'resolvedAt:', attempt.resolvedAt);
await prisma.$disconnect();
await pool.end();
