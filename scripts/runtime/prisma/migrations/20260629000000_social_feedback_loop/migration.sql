CREATE TABLE "SocialPost" (
  "id" TEXT NOT NULL,
  "localPostId" TEXT,
  "bufferPostId" TEXT,
  "organizationId" TEXT,
  "channelId" TEXT,
  "platform" TEXT,
  "status" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "mediaMetadata" JSONB,
  "generationInput" JSONB,
  "generationModel" TEXT,
  "promptVersion" TEXT,
  "topic" TEXT,
  "hookType" TEXT,
  "formatType" TEXT,
  "ctaType" TEXT,
  "scheduledAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MetricSnapshot" (
  "id" TEXT NOT NULL,
  "socialPostId" TEXT NOT NULL,
  "bufferPostId" TEXT NOT NULL,
  "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metricsUpdatedAt" TIMESTAMP(3),
  "windowHours" INTEGER,
  "rawMetrics" JSONB NOT NULL,
  "impressions" INTEGER,
  "reach" INTEGER,
  "reactions" INTEGER,
  "comments" INTEGER,
  "shares" INTEGER,
  "reposts" INTEGER,
  "saves" INTEGER,
  "clicks" INTEGER,
  "views" INTEGER,
  "follows" INTEGER,
  CONSTRAINT "MetricSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PostScore" (
  "id" TEXT NOT NULL,
  "socialPostId" TEXT NOT NULL,
  "metricSnapshotId" TEXT,
  "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "denominatorSource" TEXT,
  "engagementRate" DOUBLE PRECISION,
  "commentRate" DOUBLE PRECISION,
  "shareRate" DOUBLE PRECISION,
  "saveRate" DOUBLE PRECISION,
  "clickRate" DOUBLE PRECISION,
  "followConversionRate" DOUBLE PRECISION,
  "normalizedEngagementScore" DOUBLE PRECISION,
  "normalizedCommentScore" DOUBLE PRECISION,
  "normalizedShareScore" DOUBLE PRECISION,
  "normalizedSaveScore" DOUBLE PRECISION,
  "normalizedClickScore" DOUBLE PRECISION,
  "normalizedFollowScore" DOUBLE PRECISION,
  "percentileVsRecentPosts" DOUBLE PRECISION,
  "percentileVsSamePlatform" DOUBLE PRECISION,
  "percentileVsSameFormat" DOUBLE PRECISION,
  "finalSuccessScore" DOUBLE PRECISION,
  "label" TEXT,
  CONSTRAINT "PostScore_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FeedbackLesson" (
  "id" TEXT NOT NULL,
  "platform" TEXT,
  "topic" TEXT,
  "formatType" TEXT,
  "promptVersion" TEXT,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "windowEnd" TIMESTAMP(3) NOT NULL,
  "lessonType" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeedbackLesson_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SocialPost_localPostId_key" ON "SocialPost"("localPostId");
CREATE UNIQUE INDEX "SocialPost_bufferPostId_key" ON "SocialPost"("bufferPostId");
CREATE INDEX "SocialPost_platform_idx" ON "SocialPost"("platform");
CREATE INDEX "SocialPost_status_idx" ON "SocialPost"("status");
CREATE INDEX "SocialPost_sentAt_idx" ON "SocialPost"("sentAt");
CREATE INDEX "MetricSnapshot_bufferPostId_idx" ON "MetricSnapshot"("bufferPostId");
CREATE INDEX "MetricSnapshot_socialPostId_idx" ON "MetricSnapshot"("socialPostId");
CREATE INDEX "MetricSnapshot_collectedAt_idx" ON "MetricSnapshot"("collectedAt");
CREATE INDEX "PostScore_socialPostId_idx" ON "PostScore"("socialPostId");
CREATE INDEX "PostScore_calculatedAt_idx" ON "PostScore"("calculatedAt");
CREATE INDEX "PostScore_metricSnapshotId_idx" ON "PostScore"("metricSnapshotId");
CREATE INDEX "FeedbackLesson_platform_idx" ON "FeedbackLesson"("platform");
CREATE INDEX "FeedbackLesson_createdAt_idx" ON "FeedbackLesson"("createdAt");

ALTER TABLE "MetricSnapshot"
  ADD CONSTRAINT "MetricSnapshot_socialPostId_fkey"
  FOREIGN KEY ("socialPostId") REFERENCES "SocialPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PostScore"
  ADD CONSTRAINT "PostScore_socialPostId_fkey"
  FOREIGN KEY ("socialPostId") REFERENCES "SocialPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
