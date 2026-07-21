-- AlterTable
ALTER TABLE "RankVote" ADD COLUMN "ipHash" TEXT;

-- CreateIndex
CREATE INDEX "RankVote_ipHash_idx" ON "RankVote"("ipHash");
