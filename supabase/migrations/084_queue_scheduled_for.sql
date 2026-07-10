-- 084_queue_scheduled_for.sql
-- Streamlined social pipeline: the agents now assign a proposed posting time when they
-- build each post, so the operator's daily Review shows a fully-scheduled post. On Approve,
-- content-queue schedules to FeedHive at this time. Additive column.
ALTER TABLE content_approval_queue ADD COLUMN IF NOT EXISTS scheduled_for timestamptz;
