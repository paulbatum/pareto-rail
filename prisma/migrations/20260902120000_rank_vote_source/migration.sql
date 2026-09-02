-- AlterEnum
ALTER TYPE "RankDataClass" ADD VALUE 'unranked';

-- CreateEnum
CREATE TYPE "RankVoteSource" AS ENUM ('rank', 'custom');

-- AlterTable
ALTER TABLE "RankVote" ADD COLUMN "source" "RankVoteSource";

-- DropIndex
-- A participant may now vote on the same matchup more than once (a custom match
-- can repeat a pair). Superseded votes are kept; the aggregate counts only the
-- newest vote per matchup and participant.
DROP INDEX "RankVote_matchupId_participantHash_key";

-- CreateIndex
-- Retry idempotency moves onto the client-supplied key, which is unique per
-- submission. Existing keys derive from matchup and participant, which the
-- dropped constraint already kept unique, so no existing row collides.
CREATE UNIQUE INDEX "RankVote_idempotencyKey_key" ON "RankVote"("idempotencyKey");

-- CreateIndex
CREATE INDEX "RankVote_matchupId_participantHash_idx" ON "RankVote"("matchupId", "participantHash");
