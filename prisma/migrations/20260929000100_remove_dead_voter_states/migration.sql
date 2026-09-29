-- Elimina estados y columnas que ningun camino de ejecucion alcanza.
--
-- Cuando el cegado se traslado al cliente, el servidor dejo de poder saber si
-- una credencial fue usada: desconoce el token final. Desde entonces nada
-- escribe voters.voto_emitido, voters.voted_at, el estado VOTO_EMITIDO ni los
-- estados CONSUMIDO y REVOCADO de la credencial. Conservarlos en el esquema es
-- una invitacion a reintroducir, en un desarrollo posterior, exactamente la
-- vinculacion votante -> voto que el diseno elimina.

DROP INDEX IF EXISTS "voters_voto_emitido_idx";
ALTER TABLE "voters" DROP COLUMN IF EXISTS "voto_emitido";
ALTER TABLE "voters" DROP COLUMN IF EXISTS "voted_at";

-- PostgreSQL no permite quitar valores de un enum: se reconstruye.
UPDATE "voters" SET "estado" = 'VERIFICADO' WHERE "estado" = 'VOTO_EMITIDO';
ALTER TYPE "Estado" RENAME TO "Estado_old";
CREATE TYPE "Estado" AS ENUM ('REGISTRADO', 'VERIFICADO');
ALTER TABLE "voters" ALTER COLUMN "estado" DROP DEFAULT;
ALTER TABLE "voters" ALTER COLUMN "estado" TYPE "Estado" USING ("estado"::text::"Estado");
ALTER TABLE "voters" ALTER COLUMN "estado" SET DEFAULT 'REGISTRADO';
DROP TYPE "Estado_old";

UPDATE "vote_tokens" SET "status" = 'EXPIRADO' WHERE "status" IN ('CONSUMIDO', 'REVOCADO');
ALTER TYPE "VoteTokenStatus" RENAME TO "VoteTokenStatus_old";
CREATE TYPE "VoteTokenStatus" AS ENUM ('EMITIDO', 'EXPIRADO');
ALTER TABLE "vote_tokens" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "vote_tokens" ALTER COLUMN "status" TYPE "VoteTokenStatus" USING ("status"::text::"VoteTokenStatus");
ALTER TABLE "vote_tokens" ALTER COLUMN "status" SET DEFAULT 'EMITIDO';
DROP TYPE "VoteTokenStatus_old";

-- Columnas de la credencial que ningun camino escribe. blockchain_tx_hash es
-- ademas la que mas dano haria si alguna vez se poblara: guardaria, junto al
-- voter_id de la credencial, el hash de la transaccion desde el que se lee el
-- candidato en la cadena. Quitarla vuelve ese vinculo estructuralmente
-- imposible en lugar de meramente ausente.
ALTER TABLE "vote_tokens" DROP COLUMN IF EXISTS "used_at";
ALTER TABLE "vote_tokens" DROP COLUMN IF EXISTS "revoked_at";
ALTER TABLE "vote_tokens" DROP COLUMN IF EXISTS "blockchain_tx_hash";
