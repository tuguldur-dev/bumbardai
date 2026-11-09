ALTER TABLE "McpToken" ADD COLUMN "canSchedule" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "McpOAuthGrant" (
    "codeDigest" TEXT PRIMARY KEY,
    "clientId" TEXT NOT NULL REFERENCES "McpToken"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "challenge" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "accessDigest" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "McpOAuthGrant_accessDigest_key" ON "McpOAuthGrant"("accessDigest");
CREATE INDEX "McpOAuthGrant_expiresAt_idx" ON "McpOAuthGrant"("expiresAt");
