# Swayphics Social Lead Radar — Stage 1

## Scope

Stage 1 is an X-only, API-based discovery pilot. It searches public X posts and replies for website-buying intent, applies a strict five-minute freshness check, scores likely commercial intent, and writes qualifying signals to a separate table.

It does not change the existing leads table, create CRM leads, send messages, reply to posts, follow accounts, like posts, automate account interactions, or scrape X pages. The original post text is used transiently for classification and is not persisted.

## Technical design

- Source: X API v2 Recent Search, GET /2/tweets/search/recent.
- Cadence: Supabase Cron every minute.
- Freshness: a post is accepted only when its API created_at timestamp is between 0 and 300 seconds old at processing time. Missing, future-dated, or older posts are rejected.
- Duplicates: a persisted since_id checkpoint plus a unique (platform, external_post_id) constraint.
- Initial search window: the previous five minutes. Later runs request posts newer than the saved checkpoint.
- Search query includes matching posts and replies; retweets are excluded.
- Qualification: deterministic rules in this first pilot. This is not an AI model and it does not train on X content.
- South Africa: post text and profile location are checked transiently for South African place clues. The original location string is not stored. Signals without reliable location evidence are marked unconfirmed, not automatically discarded.
- Storage: post ID, source URL, original timestamp, discovery timestamp, age, derived intent score/type, market hint, derived match reasons, review status and expiry. Post text, full profile details, email addresses and phone numbers are not persisted.
- Retention: signals expire after 30 days.

The five-minute cutoff is enforced locally. It does not guarantee that X indexes every post immediately; indexing delays and API outages can still cause missed opportunities. A one-minute schedule means the intended polling interval is one minute, not a guarantee of delivery within one minute.

## Search terms

The initial query targets phrases including:

- "need a website"
- "looking for a website"
- "need a web designer"
- "looking for a web designer"
- "recommend a web designer"
- "website quote"
- "website cost"
- "build my website"
- "website for my business"
- "online booking system"
- "online store"

The query is intentionally bounded to one combined search per scheduled run. Widening terms increases the number of posts read and may increase cost.

## Qualification rules

The first-pass classifier assigns points for direct buying language, recommendation requests, pricing enquiries, website improvement requests, e-commerce/booking requirements, business context and South African location clues.

- High intent: score of 70 or more.
- Medium intent: score from 45 to 69.
- Below 45: discarded.
- Service-provider self-promotion and education/employment posts receive strong negative scoring.

A score is a prioritisation signal, not proof that the author is a buyer. Human review remains mandatory.

## Estimated X API usage

The X Developer Platform currently displays a unit price of USD $0.005 per post read. Illustrative consumption at that displayed rate:

| Posts read | Illustrative API charge |
|---:|---:|
| 100 | $0.50 |
| 1,000 | $5.00 |
| 10,000 | $50.00 |

Actual consumption depends on matching post volume, pagination, retries and the current X price schedule. Run the pilot in dry-run mode first and inspect actual usage in the X Developer Console before enabling continuous monitoring. The function uses one combined query and a since_id checkpoint to avoid repeatedly reading already-seen posts.

## Prerequisites before deployment

1. Create an X developer project/app in the official Developer Console and obtain an app Bearer Token.
2. Confirm that the app has access to the Recent Search endpoint and has sufficient API credits.
3. Give X an accurate use-case description: internal monitoring of public posts and replies for people expressly seeking website design/development, e-commerce or online-booking help; deterministic intent classification; human-reviewed source links for Swayphics sales staff; no automated replies, DMs, follows, likes, scraping or model training.
4. In the Swayphics Supabase project's Edge Function Secrets, set:
   - X_API_BEARER_TOKEN — the X app Bearer Token.
   - SOCIAL_RADAR_CRON_SECRET — a long, random secret used only by the scheduled invocation.
5. Do not paste either secret into GitHub, this chat, browser JavaScript or the function source.

Supabase supplies SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to hosted Edge Functions. The service-role key is used server-side only.

## Database migration

The migration is staged at:

supabase/migrations/20261103154300_social_lead_radar.sql

It creates two isolated tables:

- social_lead_signals: read access for Swayphics admins only, with update permission limited to review_status; inserts are made by the server-side function.
- social_radar_state: service-role-only checkpoint storage.

The migration has not been applied to the live Supabase project. It requires explicit approval before execution.

The project must also expose the new table through its Data API settings before the dashboard can query it through Supabase REST. New public-schema tables are not necessarily exposed automatically.

## Deploy the Edge Function

Deploy supabase/functions/social-lead-radar/index.ts as a new Supabase Edge Function named social-lead-radar with gateway JWT verification disabled. The function independently checks the x-radar-cron-secret header before doing any work. Do not disable this custom check.

The code is designed to use verify_jwt = false because the scheduled request uses a separate high-entropy shared secret. The secret must not be exposed to browser code.

## Test once before scheduling

After the database migration and function deployment have been approved and completed, run a dry-run request from a trusted terminal. Replace the placeholders with the actual project reference, publishable key and secret:

    curl -X POST "https://PROJECT_REF.supabase.co/functions/v1/social-lead-radar" \
      -H "apikey: SUPABASE_PUBLISHABLE_KEY" \
      -H "x-radar-cron-secret: SOCIAL_RADAR_CRON_SECRET" \
      -H "Content-Type: application/json" \
      -d '{"dry_run":true}'

Dry-run returns candidate post IDs, links, ages, scores and categories but does not write signals or advance the checkpoint. It still reads posts from X and may incur API charges.

Confirm that every returned candidate has age_seconds between 0 and 300. Inspect linked posts manually and check API credit consumption before enabling the scheduled job.

## Schedule every minute

Enable the pg_cron and pg_net extensions in Supabase if they are not already enabled. Store the same SOCIAL_RADAR_CRON_SECRET in Supabase Vault once, using the SQL Editor:

    select vault.create_secret('REPLACE_WITH_SOCIAL_RADAR_CRON_SECRET', 'social_radar_cron_secret');

Then schedule the function every minute. Replace the project reference and publishable key placeholders:

    select cron.schedule(
      'swayphics-social-lead-radar-every-minute',
      '* * * * *',
      $$
      select net.http_post(
        url := 'https://PROJECT_REF.supabase.co/functions/v1/social-lead-radar',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', 'SUPABASE_PUBLISHABLE_KEY',
          'x-radar-cron-secret',
            (select decrypted_secret
             from vault.decrypted_secrets
             where name = 'social_radar_cron_secret')
        ),
        body := '{"dry_run":false}'::jsonb,
        timeout_milliseconds := 10000
      );
      $$
    );

Also schedule daily expiry cleanup:

    select cron.schedule(
      'swayphics-social-lead-radar-retention',
      '15 2 * * *',
      $$ delete from public.social_lead_signals where expires_at <= now(); $$
    );

Do not schedule the job until the first dry-run has been reviewed and its X API consumption is acceptable.

## Operational checks

After activation:

- Check Cron job run history for one-minute execution and failures.
- Check Edge Function logs for X 401, 403 or 429 responses and Supabase write errors.
- Check X Developer Console consumption daily during the pilot.
- Confirm newest signals are no more than five minutes old at ingestion.
- Verify no duplicate (platform, external_post_id) records.
- Review the first 20–30 candidate links manually and adjust keywords/scoring based on false positives and missed intent.
- Pause the job if usage is materially higher than the agreed pilot budget.

## Stage 1 completion criteria

Stage 1 is complete only when:

1. X API authentication succeeds.
2. The scheduled job runs once per minute without repeated errors.
3. Every saved signal passes the strict 300-second age check.
4. Duplicate posts are not inserted twice.
5. The classifier separates likely buyers from providers, students and irrelevant mentions at acceptable precision.
6. Actual X API consumption is measured and accepted.
7. No social signal is automatically converted into a CRM lead or contacted.

The admin-dashboard integration and additional social platforms are Stage 2/3 work, not part of this isolated Stage 1 backend pilot.

## Official references

- X Recent Search: https://developer.x.com/en/docs/x-api/tweets/search/api-reference/get-tweets-search-recent
- X API pricing: https://developer.x.com/en/products/x-api
- X Developer Guidelines: https://developer.x.com/en/developer-terms/policy
- Supabase Edge Function secrets: https://supabase.com/docs/guides/functions/secrets
- Supabase Cron: https://supabase.com/docs/guides/cron
- Supabase Edge Function scheduling: https://supabase.com/docs/guides/functions/schedule-functions
