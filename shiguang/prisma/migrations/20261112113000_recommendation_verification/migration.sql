ALTER TABLE "UserTasteProfile" ADD COLUMN "resetAt" TIMESTAMP(3);

ALTER TABLE "Dish"
ADD COLUMN "verifiedDietPatterns" "DietPattern"[] DEFAULT ARRAY[]::"DietPattern"[],
ADD COLUMN "dietVerifiedAt" TIMESTAMP(3);

CREATE TABLE "RecommendationConfig" (
    "id" TEXT NOT NULL,
    "weights" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RecommendationConfig_pkey" PRIMARY KEY ("id")
);
