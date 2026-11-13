BEGIN;

ALTER TABLE "Order" ADD COLUMN "requestFingerprint" TEXT;
CREATE UNIQUE INDEX "Order_userId_idempotencyKey_key" ON "Order" ("userId", "idempotencyKey");
DROP INDEX "Order_idempotencyKey_key";

COMMIT;
