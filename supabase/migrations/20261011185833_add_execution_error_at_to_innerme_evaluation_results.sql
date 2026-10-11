-- Preserve the timestamp of the latest execution-error attempt so provider
-- cooldowns are calculated from the error event rather than the overall run.
ALTER TABLE public.innerme_evaluation_results
  ADD COLUMN IF NOT EXISTS execution_error_at timestamptz;

COMMENT ON COLUMN public.innerme_evaluation_results.execution_error_at IS
  'Timestamp of the latest retryable execution error for this benchmark case; NULL when the case has no current execution error.';
