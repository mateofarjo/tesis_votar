-- Limitador de tasa sobre almacenamiento compartido.
--
-- El conteo vivia en un Map del objeto global del proceso, de modo que en un
-- despliegue con varias instancias cada una aplicaba su propio limite. El
-- INSERT ... ON CONFLICT de lib/rateLimit.ts resuelve el incremento en una
-- unica sentencia atomica sobre esta tabla.
CREATE TABLE IF NOT EXISTS "rate_limits" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "reset_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("key")
);

CREATE INDEX IF NOT EXISTS "rate_limits_reset_at_idx" ON "rate_limits"("reset_at");
