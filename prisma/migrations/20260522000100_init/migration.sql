-- CreateEnum
CREATE TYPE "Estado" AS ENUM ('REGISTRADO', 'VERIFICADO', 'VOTO_EMITIDO');

-- CreateEnum
CREATE TYPE "VerificationType" AS ENUM ('REGISTRO', 'LIVENESS');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDIENTE', 'APROBADO', 'RECHAZADO', 'EXPIRADO', 'ERROR');

-- CreateEnum
CREATE TYPE "VoteTokenStatus" AS ENUM ('EMITIDO', 'CONSUMIDO', 'REVOCADO', 'EXPIRADO');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('VOTER', 'AUTORIDAD', 'SISTEMA', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM (
  'REGISTRO_INICIADO',
  'REGISTRO_APROBADO',
  'REGISTRO_RECHAZADO',
  'LOGIN_OK',
  'LOGIN_FALLIDO',
  'BIOMETRIA_VERIFICADA',
  'BIOMETRIA_RECHAZADA',
  'TOKEN_GENERADO',
  'TOKEN_CONSUMIDO',
  'VOTO_ENVIADO',
  'VOTO_CONFIRMADO',
  'WEBHOOK_VERIFF_RECIBIDO',
  'WEBHOOK_VERIFF_INVALIDO',
  'ADMIN_LOGIN',
  'URNA_ABIERTA',
  'URNA_CERRADA'
);

-- CreateTable
CREATE TABLE "voters" (
  "id" TEXT NOT NULL,
  "dni_hash" VARCHAR(64) NOT NULL,
  "biometric_hash" VARCHAR(64) NOT NULL,
  "estado" "Estado" NOT NULL DEFAULT 'REGISTRADO',
  "voto_emitido" BOOLEAN NOT NULL DEFAULT false,
  "veriff_person_id" TEXT,
  "verified_at" TIMESTAMP(3),
  "voted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "voters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_attempts" (
  "id" TEXT NOT NULL,
  "voter_id" TEXT,
  "type" "VerificationType" NOT NULL,
  "status" "VerificationStatus" NOT NULL DEFAULT 'PENDIENTE',
  "veriff_session_id" TEXT NOT NULL,
  "veriff_attempt_id" TEXT,
  "reference_id" TEXT,
  "dni_hash" VARCHAR(64),
  "biometric_hash" VARCHAR(64),
  "biometric_match" BOOLEAN,
  "failure_reason" TEXT,
  "initiated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "verification_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vote_tokens" (
  "id" TEXT NOT NULL,
  "voter_id" TEXT NOT NULL,
  "verification_attempt_id" TEXT,
  "token_hash" VARCHAR(64) NOT NULL,
  "signed_token_hash" VARCHAR(64) NOT NULL,
  "status" "VoteTokenStatus" NOT NULL DEFAULT 'EMITIDO',
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "blockchain_tx_hash" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "vote_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
  "id" TEXT NOT NULL,
  "voter_id" TEXT,
  "vote_token_id" TEXT,
  "actor_type" "ActorType" NOT NULL,
  "action" "AuditAction" NOT NULL,
  "session_id" TEXT,
  "ip_hash" VARCHAR(64),
  "user_agent_hash" VARCHAR(64),
  "resource_type" TEXT,
  "resource_id" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "voters_dni_hash_key" ON "voters"("dni_hash");

-- CreateIndex
CREATE UNIQUE INDEX "voters_biometric_hash_key" ON "voters"("biometric_hash");

-- CreateIndex
CREATE UNIQUE INDEX "voters_veriff_person_id_key" ON "voters"("veriff_person_id");

-- CreateIndex
CREATE INDEX "voters_estado_idx" ON "voters"("estado");

-- CreateIndex
CREATE INDEX "voters_voto_emitido_idx" ON "voters"("voto_emitido");

-- CreateIndex
CREATE UNIQUE INDEX "verification_attempts_veriff_session_id_key" ON "verification_attempts"("veriff_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "verification_attempts_veriff_attempt_id_key" ON "verification_attempts"("veriff_attempt_id");

-- CreateIndex
CREATE INDEX "verification_attempts_voter_id_type_idx" ON "verification_attempts"("voter_id", "type");

-- CreateIndex
CREATE INDEX "verification_attempts_dni_hash_type_idx" ON "verification_attempts"("dni_hash", "type");

-- CreateIndex
CREATE INDEX "verification_attempts_status_type_idx" ON "verification_attempts"("status", "type");

-- CreateIndex
CREATE UNIQUE INDEX "vote_tokens_token_hash_key" ON "vote_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "vote_tokens_signed_token_hash_key" ON "vote_tokens"("signed_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "vote_tokens_blockchain_tx_hash_key" ON "vote_tokens"("blockchain_tx_hash");

-- CreateIndex
CREATE INDEX "vote_tokens_voter_id_status_idx" ON "vote_tokens"("voter_id", "status");

-- CreateIndex
CREATE INDEX "vote_tokens_expires_at_idx" ON "vote_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_voter_id_created_at_idx" ON "audit_logs"("voter_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_vote_token_id_idx" ON "audit_logs"("vote_token_id");

-- CreateIndex
CREATE INDEX "audit_logs_session_id_idx" ON "audit_logs"("session_id");

-- AddForeignKey
ALTER TABLE "verification_attempts"
ADD CONSTRAINT "verification_attempts_voter_id_fkey"
FOREIGN KEY ("voter_id") REFERENCES "voters"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_tokens"
ADD CONSTRAINT "vote_tokens_voter_id_fkey"
FOREIGN KEY ("voter_id") REFERENCES "voters"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_tokens"
ADD CONSTRAINT "vote_tokens_verification_attempt_id_fkey"
FOREIGN KEY ("verification_attempt_id") REFERENCES "verification_attempts"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs"
ADD CONSTRAINT "audit_logs_voter_id_fkey"
FOREIGN KEY ("voter_id") REFERENCES "voters"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs"
ADD CONSTRAINT "audit_logs_vote_token_id_fkey"
FOREIGN KEY ("vote_token_id") REFERENCES "vote_tokens"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
