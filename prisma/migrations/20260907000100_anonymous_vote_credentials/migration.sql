ALTER TABLE "vote_tokens" ALTER COLUMN "token_hash" DROP NOT NULL;
ALTER TABLE "vote_tokens" ALTER COLUMN "signed_token_hash" DROP NOT NULL;
