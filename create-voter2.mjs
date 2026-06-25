import { config } from 'dotenv';
config({ path: '.env.local' });
const { PrismaPg } = await import('@prisma/adapter-pg');
const { PrismaClient } = await import('@prisma/client');
const pg = await import('pg');
const pool = new pg.default.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

import crypto from 'crypto';
// voter 2: dni=99999999 → hash
const dniHash = crypto.createHash('sha256').update('99999999', 'utf8').digest('hex');
const biometricHash = crypto.createHash('sha256').update('voter2biometric', 'utf8').digest('hex');
const voter = await prisma.voter.create({ data: { dniHash, biometricHash, estado: 'VERIFICADO' } });
console.log('voter2 id:', voter.id, 'dniHash:', voter.dniHash);
await prisma.$disconnect(); await pool.end();
