-- For installations that already applied the plan-repairs patch.
ALTER TABLE "BreakSchedule" ADD COLUMN IF NOT EXISTS "durationException" BOOLEAN NOT NULL DEFAULT false;
