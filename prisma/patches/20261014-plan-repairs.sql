BEGIN;
-- DropIndex
DROP INDEX "Acknowledgement_employeeId_taskCategoryId_scheduleDate_key";

-- AlterTable
ALTER TABLE "SchedulePeriod" ADD COLUMN     "warnings" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "BreakSchedule" ADD COLUMN     "coverEmployeeId" TEXT,
ADD COLUMN "durationException" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Acknowledgement" ADD COLUMN     "planRevision" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "SlackPostLog" ADD COLUMN     "deliveryKey" TEXT,
ADD COLUMN     "planRevision" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "DailyPlan" (
    "date" DATE NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "configHash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyPlan_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "SlackDirectDelivery" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlackDirectDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SlackDirectDelivery_postId_employeeId_key" ON "SlackDirectDelivery"("postId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Acknowledgement_employeeId_taskCategoryId_scheduleDate_plan_key" ON "Acknowledgement"("employeeId", "taskCategoryId", "scheduleDate", "planRevision");

-- CreateIndex
CREATE UNIQUE INDEX "SlackPostLog_deliveryKey_key" ON "SlackPostLog"("deliveryKey");

-- AddForeignKey
ALTER TABLE "SlackDirectDelivery" ADD CONSTRAINT "SlackDirectDelivery_postId_fkey" FOREIGN KEY ("postId") REFERENCES "SlackPostLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
COMMIT;
