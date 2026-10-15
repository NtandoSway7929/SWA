-- Add the production-equivalent support triggers for InnerMe's knowledge schema.
-- Idempotent so existing production triggers are preserved and isolated schema drift
-- can be repaired after the knowledge tables/RPC baseline has been installed.

DO $trigger_functions$
BEGIN
  IF to_regprocedure('public.set_innerme_updated_at()') IS NULL THEN
    EXECUTE $set_updated_at_function$
      CREATE FUNCTION public.set_innerme_updated_at()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $set_updated_at_body$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $set_updated_at_body$;
    $set_updated_at_function$;
  END IF;

  IF to_regprocedure('public.refresh_innerme_embedding_text()') IS NULL THEN
    EXECUTE $refresh_embedding_text_function$
      CREATE FUNCTION public.refresh_innerme_embedding_text()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $refresh_embedding_text_body$
      BEGIN
        NEW.embedding_text := trim(concat_ws(E'\n',
          NEW.title,
          'Domain: ' || NEW.domain,
          'Type: ' || NEW.knowledge_type,
          'Statement: ' || NEW.statement,
          CASE WHEN NEW.application IS NOT NULL AND NEW.application <> '' THEN 'Application: ' || NEW.application END,
          CASE WHEN NEW.constraints IS NOT NULL AND NEW.constraints <> '' THEN 'Constraints: ' || NEW.constraints END,
          CASE WHEN NEW.do_not_use_when IS NOT NULL AND NEW.do_not_use_when <> '' THEN 'Do not use when: ' || NEW.do_not_use_when END,
          'Evidence: ' || NEW.evidence_level,
          'Jurisdiction: ' || NEW.jurisdiction,
          CASE WHEN NEW.tags <> '[]'::jsonb THEN 'Tags: ' || NEW.tags::text END
        ));
        RETURN NEW;
      END;
      $refresh_embedding_text_body$;
    $refresh_embedding_text_function$;
  END IF;
END
$trigger_functions$;

DO $knowledge_triggers$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.innerme_knowledge'::regclass
      AND tgname = 'innerme_knowledge_embedding_text'
      AND NOT tgisinternal
  ) THEN
    EXECUTE $create_embedding_trigger$
      CREATE TRIGGER innerme_knowledge_embedding_text
      BEFORE INSERT OR UPDATE OF title, domain, knowledge_type, statement,
        application, constraints, do_not_use_when, evidence_level, jurisdiction, tags
      ON public.innerme_knowledge
      FOR EACH ROW EXECUTE FUNCTION public.refresh_innerme_embedding_text();
    $create_embedding_trigger$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.innerme_knowledge'::regclass
      AND tgname = 'innerme_knowledge_updated_at'
      AND NOT tgisinternal
  ) THEN
    EXECUTE $create_knowledge_updated_at$
      CREATE TRIGGER innerme_knowledge_updated_at
      BEFORE UPDATE ON public.innerme_knowledge
      FOR EACH ROW EXECUTE FUNCTION public.set_innerme_updated_at();
    $create_knowledge_updated_at$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.innerme_knowledge_sources'::regclass
      AND tgname = 'innerme_knowledge_sources_updated_at'
      AND NOT tgisinternal
  ) THEN
    EXECUTE $create_sources_updated_at$
      CREATE TRIGGER innerme_knowledge_sources_updated_at
      BEFORE UPDATE ON public.innerme_knowledge_sources
      FOR EACH ROW EXECUTE FUNCTION public.set_innerme_updated_at();
    $create_sources_updated_at$;
  END IF;
END
$knowledge_triggers$;

NOTIFY pgrst, 'reload schema';
