-- Admin-only, read-only aggregate for InnerMe provider observability.
-- Raw usage rows and quota counters remain protected by their existing RLS/grants.

CREATE OR REPLACE FUNCTION public.get_innerme_provider_health_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.now();
  v_utc_date date := (pg_catalog.now() AT TIME ZONE 'UTC')::date;
  v_payload jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_swayphics_admin() THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Admin access required';
  END IF;

  SELECT pg_catalog.jsonb_build_object(
    'generated_at', v_now,
    'window_hours', 24,
    'summary', (
      SELECT pg_catalog.jsonb_build_object(
        'attempts', count(*),
        'successes', count(*) FILTER (WHERE u.outcome = 'success'),
        'failures', count(*) FILTER (WHERE u.outcome = 'error'),
        'success_rate_pct', CASE WHEN count(*) = 0 THEN 0
          ELSE round((100.0 * count(*) FILTER (WHERE u.outcome = 'success') / count(*))::numeric, 2) END,
        'timeouts', count(*) FILTER (
          WHERE coalesce(u.error_code, '') ILIKE '%timeout%'
             OR coalesce(u.fallback_reason, '') ILIKE '%timeout%'
        ),
        'avg_latency_ms', coalesce(round(avg(u.latency_ms)::numeric), 0),
        'p95_latency_ms', coalesce(round((percentile_cont(0.95) WITHIN GROUP (ORDER BY u.latency_ms))::numeric), 0),
        'reported_input_tokens', coalesce(sum(u.input_tokens), 0),
        'reported_output_tokens', coalesce(sum(u.output_tokens), 0)
      )
      FROM public.innerme_provider_usage AS u
      WHERE u.created_at >= v_now - interval '24 hours'
    ),
    'providers', (
      SELECT coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'provider', s.provider,
            'attempts', s.attempts,
            'successes', s.successes,
            'failures', s.failures,
            'success_rate_pct', s.success_rate_pct,
            'timeouts', s.timeouts,
            'avg_latency_ms', s.avg_latency_ms,
            'p95_latency_ms', s.p95_latency_ms
          ) ORDER BY s.provider
        ),
        '[]'::jsonb
      )
      FROM (
        SELECT
          u.provider,
          count(*) AS attempts,
          count(*) FILTER (WHERE u.outcome = 'success') AS successes,
          count(*) FILTER (WHERE u.outcome = 'error') AS failures,
          CASE WHEN count(*) = 0 THEN 0
            ELSE round((100.0 * count(*) FILTER (WHERE u.outcome = 'success') / count(*))::numeric, 2) END AS success_rate_pct,
          count(*) FILTER (
            WHERE coalesce(u.error_code, '') ILIKE '%timeout%'
               OR coalesce(u.fallback_reason, '') ILIKE '%timeout%'
          ) AS timeouts,
          coalesce(round(avg(u.latency_ms)::numeric), 0) AS avg_latency_ms,
          coalesce(round((percentile_cont(0.95) WITHIN GROUP (ORDER BY u.latency_ms))::numeric), 0) AS p95_latency_ms
        FROM public.innerme_provider_usage AS u
        WHERE u.created_at >= v_now - interval '24 hours'
        GROUP BY u.provider
      ) AS s
    ),
    'daily_quota', pg_catalog.jsonb_build_object(
      'date_utc', v_utc_date,
      'cloudflare', pg_catalog.jsonb_build_object(
        'reserved', coalesce((
          SELECT q.request_count FROM public.innerme_provider_quota_daily AS q
          WHERE q.provider = 'cloudflare' AND q.quota_date = v_utc_date
        ), 0),
        'limit', 100,
        'model', '@cf/meta/llama-3.1-8b-instruct-fp8'
      ),
      'gemini', pg_catalog.jsonb_build_object(
        'reserved', coalesce((
          SELECT q.request_count FROM public.innerme_provider_quota_daily AS q
          WHERE q.provider = 'gemini' AND q.quota_date = v_utc_date
        ), 0),
        'limit', 40,
        'models', pg_catalog.jsonb_build_array('gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite')
      )
    ),
    'recent_attempts', (
      SELECT coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'created_at', r.created_at,
            'task_category', r.task_category,
            'provider', r.provider,
            'model', r.model,
            'outcome', r.outcome,
            'http_status', r.http_status,
            'latency_ms', r.latency_ms,
            'input_tokens', r.input_tokens,
            'output_tokens', r.output_tokens,
            'error_code', r.error_code,
            'fallback_reason', r.fallback_reason
          ) ORDER BY r.created_at DESC
        ),
        '[]'::jsonb
      )
      FROM (
        SELECT u.created_at, u.task_category, u.provider, u.model, u.outcome,
               u.http_status, u.latency_ms, u.input_tokens, u.output_tokens,
               u.error_code, u.fallback_reason
        FROM public.innerme_provider_usage AS u
        WHERE u.created_at >= v_now - interval '24 hours'
        ORDER BY u.created_at DESC
        LIMIT 20
      ) AS r
    )
  )
  INTO v_payload;

  RETURN v_payload;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_innerme_provider_health_summary() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_innerme_provider_health_summary() TO authenticated;

COMMENT ON FUNCTION public.get_innerme_provider_health_summary() IS
  'Returns aggregate provider routing health and limited recent attempt metadata for active Swayphics admins; does not expose prompts, answers, business records, or quota rows.';
