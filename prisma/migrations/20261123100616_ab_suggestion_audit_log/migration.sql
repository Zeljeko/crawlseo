-- CreateTable
CREATE TABLE "AbSuggestion" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "pageUrl" TEXT,
    "issueRef" TEXT,
    "type" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT NOT NULL,
    "rationale" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "wpPostId" INTEGER,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "estCostUsd" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,

    CONSTRAINT "AbSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbAuditLog" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AbAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AbSuggestion_siteId_status_createdAt_idx" ON "AbSuggestion"("siteId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AbAuditLog_targetType_targetId_idx" ON "AbAuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AbAuditLog_createdAt_idx" ON "AbAuditLog"("createdAt");
