-- AlterTable
-- Backfill values must equal what Better Auth 1.7 itself writes and looks up
-- (@better-auth/core db/schema/account: createLocalAccountIssuer /
-- createOAuthAccountIssuer), or existing accounts stop resolving. See #456.
ALTER TABLE "account" ADD COLUMN "issuer" TEXT;

UPDATE "account"
SET "issuer" = CASE
        WHEN "providerId" = 'credential' THEN 'local:credential'
        ELSE 'local:oauth:' || "providerId"
    END
WHERE "issuer" IS NULL;

ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;
