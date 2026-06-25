import { config } from 'dotenv';
config({ path: '.env.local' });

const { PrismaPg } = await import('@prisma/adapter-pg');
const { PrismaClient } = await import('@prisma/client');
const pg = await import('pg');
const Pool = pg.default.Pool;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const voters = await prisma.voter.findMany({ take: 10 });
console.log('voters:', JSON.stringify(voters, null, 2));
await prisma.$disconnect();
await pool.end();
