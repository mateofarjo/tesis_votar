CREATE TABLE "passkeys" (
  "id" TEXT NOT NULL, "credential_id" TEXT NOT NULL, "public_key" BYTEA NOT NULL,
  "counter" BIGINT NOT NULL DEFAULT 0, "transports" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "last_used_at" TIMESTAMP(3), "voter_id" TEXT NOT NULL,
  CONSTRAINT "passkeys_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "passkeys_credential_id_key" ON "passkeys"("credential_id");
CREATE INDEX "passkeys_voter_id_idx" ON "passkeys"("voter_id");
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_voter_id_fkey" FOREIGN KEY ("voter_id") REFERENCES "voters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "webauthn_challenges" (
  "id" TEXT NOT NULL, "challenge" TEXT NOT NULL, "purpose" TEXT NOT NULL, "expires_at" TIMESTAMP(3) NOT NULL, "voter_id" TEXT NOT NULL,
  CONSTRAINT "webauthn_challenges_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "webauthn_challenges_challenge_key" ON "webauthn_challenges"("challenge");
CREATE INDEX "webauthn_challenges_voter_id_purpose_idx" ON "webauthn_challenges"("voter_id", "purpose");
CREATE INDEX "webauthn_challenges_expires_at_idx" ON "webauthn_challenges"("expires_at");
ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_voter_id_fkey" FOREIGN KEY ("voter_id") REFERENCES "voters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
