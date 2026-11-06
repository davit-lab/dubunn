-- Merge changed object fields; arrays represent an explicitly edited collection.
CREATE OR REPLACE FUNCTION public.merge_content_patch(_base jsonb, _patch jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE result jsonb := COALESCE(_base, '{}'::jsonb); key text; value jsonb;
BEGIN
  IF jsonb_typeof(_patch) <> 'object' THEN RETURN _patch; END IF;
  IF jsonb_typeof(result) <> 'object' THEN result := '{}'::jsonb; END IF;
  FOR key, value IN SELECT * FROM jsonb_each(_patch) LOOP
    result := jsonb_set(result, ARRAY[key], public.merge_content_patch(result->key, value), true);
  END LOOP;
  RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.merge_content_patch(jsonb,jsonb) FROM PUBLIC, anon, authenticated;

-- Content changes are explicit admin patches. Older full-document saves cannot overwrite them.
CREATE OR REPLACE FUNCTION public.patch_site_content(
  _assets jsonb DEFAULT '{}'::jsonb,
  _translations jsonb DEFAULT '{}'::jsonb,
  _reset boolean DEFAULT false
) RETURNS public.site_content
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE current_row public.site_content; language_key text; language_patch jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(_assets) <> 'object' OR jsonb_typeof(_translations) <> 'object' THEN
    RAISE EXCEPTION 'Content patches must be JSON objects';
  END IF;
  SELECT * INTO current_row FROM public.site_content WHERE id = 'main' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Site content is missing'; END IF;
  IF _reset THEN
    current_row.assets := _assets;
    current_row.translations := _translations;
  ELSE
    current_row.assets := public.merge_content_patch(current_row.assets, _assets);
    FOR language_key, language_patch IN SELECT * FROM jsonb_each(_translations) LOOP
      IF language_key NOT IN ('ka', 'en') OR jsonb_typeof(language_patch) <> 'object' THEN
        RAISE EXCEPTION 'Invalid translation patch';
      END IF;
      current_row.translations := jsonb_set(current_row.translations, ARRAY[language_key],
        public.merge_content_patch(current_row.translations->language_key, language_patch), true);
    END LOOP;
  END IF;
  UPDATE public.site_content SET assets = current_row.assets, translations = current_row.translations
    WHERE id = 'main' RETURNING * INTO current_row;
  RETURN current_row;
END; $$;
REVOKE ALL ON FUNCTION public.patch_site_content(jsonb,jsonb,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.patch_site_content(jsonb,jsonb,boolean) TO authenticated;
DROP POLICY IF EXISTS "admins insert site_content" ON public.site_content;
DROP POLICY IF EXISTS "admins update site_content" ON public.site_content;
