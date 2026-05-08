-- CreateEnum
CREATE TYPE "BountyStatus" AS ENUM ('OPEN', 'RESERVED', 'INVOICE_CREATED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RewardStatus" AS ENUM ('PENDING_INVITE', 'WAITING_FOR_ACCEPTANCE', 'INVOICE_CREATED', 'PAID', 'FAILED');

-- CreateTable
CREATE TABLE "RepositoryInstallation" (
    "id" TEXT NOT NULL,
    "installationId" BIGINT NOT NULL,
    "owner" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "githubNodeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepositoryInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GithubUserLink" (
    "id" TEXT NOT NULL,
    "githubLogin" TEXT NOT NULL,
    "githubUserId" BIGINT,
    "pviumUserId" TEXT NOT NULL,
    "pviumHandle" TEXT,
    "pviumAccessToken" TEXT,
    "pviumRefreshToken" TEXT,
    "pviumTokenType" TEXT,
    "pviumAccessTokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GithubUserLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bounty" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "issueNumber" INTEGER NOT NULL,
    "issueNodeId" TEXT,
    "labelName" TEXT NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "BountyStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bounty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardAttempt" (
    "id" TEXT NOT NULL,
    "bountyId" TEXT NOT NULL,
    "githubUserLinkId" TEXT,
    "pullRequestNumber" INTEGER NOT NULL,
    "pullRequestNodeId" TEXT,
    "solverGithubLogin" TEXT NOT NULL,
    "solverGithubUserId" BIGINT,
    "pviumInviteLink" TEXT,
    "pviumInvoiceId" TEXT,
    "pviumInvoiceUrl" TEXT,
    "status" "RewardStatus" NOT NULL DEFAULT 'PENDING_INVITE',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "action" TEXT,
    "repository" TEXT,
    "sender" TEXT,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RepositoryInstallation_installationId_key" ON "RepositoryInstallation"("installationId");

-- CreateIndex
CREATE UNIQUE INDEX "RepositoryInstallation_owner_repo_key" ON "RepositoryInstallation"("owner", "repo");

-- CreateIndex
CREATE UNIQUE INDEX "GithubUserLink_githubLogin_key" ON "GithubUserLink"("githubLogin");

-- CreateIndex
CREATE UNIQUE INDEX "GithubUserLink_githubUserId_key" ON "GithubUserLink"("githubUserId");

-- CreateIndex
CREATE INDEX "Bounty_repositoryId_issueNumber_idx" ON "Bounty"("repositoryId", "issueNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Bounty_repositoryId_issueNumber_labelName_key" ON "Bounty"("repositoryId", "issueNumber", "labelName");

-- CreateIndex
CREATE UNIQUE INDEX "RewardAttempt_bountyId_pullRequestNumber_solverGithubLogin_key" ON "RewardAttempt"("bountyId", "pullRequestNumber", "solverGithubLogin");

-- AddForeignKey
ALTER TABLE "Bounty" ADD CONSTRAINT "Bounty_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "RepositoryInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardAttempt" ADD CONSTRAINT "RewardAttempt_bountyId_fkey" FOREIGN KEY ("bountyId") REFERENCES "Bounty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardAttempt" ADD CONSTRAINT "RewardAttempt_githubUserLinkId_fkey" FOREIGN KEY ("githubUserLinkId") REFERENCES "GithubUserLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;
