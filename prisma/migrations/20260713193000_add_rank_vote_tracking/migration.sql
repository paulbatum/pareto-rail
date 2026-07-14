-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RankVerdict" AS ENUM ('a-better', 'b-better', 'both-good', 'both-bad');

-- CreateEnum
CREATE TYPE "RankRelative" AS ENUM ('a', 'b', 'tie');

-- CreateEnum
CREATE TYPE "RankSentiment" AS ENUM ('positive', 'negative');

-- CreateEnum
CREATE TYPE "RankDataClass" AS ENUM ('eligible', 'rehearsal', 'development');

-- CreateTable
CREATE TABLE "RankMatchup" (
    "id" TEXT NOT NULL,
    "benchmarkVersion" TEXT NOT NULL,
    "themeId" TEXT NOT NULL,
    "levelIdFirst" TEXT NOT NULL,
    "levelIdSecond" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RankMatchup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankVote" (
    "id" TEXT NOT NULL,
    "matchupId" TEXT NOT NULL,
    "participantHash" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "aLevelId" TEXT NOT NULL,
    "bLevelId" TEXT NOT NULL,
    "verdict" "RankVerdict" NOT NULL,
    "relative" "RankRelative" NOT NULL,
    "sentiment" "RankSentiment",
    "playCountA" INTEGER NOT NULL,
    "playCountB" INTEGER NOT NULL,
    "bestScoreA" INTEGER,
    "bestScoreB" INTEGER,
    "dataClass" "RankDataClass" NOT NULL,
    "assignedAt" TIMESTAMP(3),
    "clientSubmittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT,

    CONSTRAINT "RankVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RankMatchup_benchmarkVersion_themeId_idx" ON "RankMatchup"("benchmarkVersion", "themeId");

-- CreateIndex
CREATE INDEX "RankVote_createdAt_idx" ON "RankVote"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RankVote_matchupId_participantHash_key" ON "RankVote"("matchupId", "participantHash");

-- AddForeignKey
ALTER TABLE "RankVote" ADD CONSTRAINT "RankVote_matchupId_fkey" FOREIGN KEY ("matchupId") REFERENCES "RankMatchup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
