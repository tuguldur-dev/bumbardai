ALTER TABLE "Quest" ADD COLUMN "templateKey" TEXT;
CREATE UNIQUE INDEX "Quest_userId_templateKey_key" ON "Quest"("userId", "templateKey");
