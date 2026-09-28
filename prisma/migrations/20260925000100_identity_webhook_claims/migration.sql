ALTER TABLE "verification_attempts"
  ADD COLUMN "biometric_score" DOUBLE PRECISION,
  ADD COLUMN "identity_provider" TEXT,
  ADD COLUMN "provider_decision_hash" VARCHAR(64),
  ADD COLUMN "webhook_claimed_at" TIMESTAMP(3);

CREATE INDEX "verification_attempts_status_webhook_claimed_at_idx"
  ON "verification_attempts"("status", "webhook_claimed_at");
