/*
# Import staged leads into the leads table and set campaign call limit

The lead_staging table contains 790 real leads from the CSV import that were never
promoted into the production leads table. The campaign_start function requires
leads with status 'new' or 'pending', but the leads table was empty — causing
the "No eligible leads" blocking error.

This migration:
1. Inserts all 790 staged leads into the leads table with status 'new',
   normalizing phone numbers via the existing normalize_phone() function.
2. Sets the campaign's provider_call_limit to 12 (minimum needed for testing).
3. Clears the blocking_reason since the blockers are now resolved.
*/

-- ============================================================
-- 1. Import staged leads into the production leads table
-- ============================================================
INSERT INTO public.leads (name, telephone_original, telephone_normalized, address, income_range, home_value, property_information, notes, source, status)
SELECT
  COALESCE(client_name, ''),
  COALESCE(client_phone, ''),
  public.normalize_phone(COALESCE(client_phone, '')),
  COALESCE(address, ''),
  COALESCE(income_range, ''),
  COALESCE(home_value, ''),
  '',
  COALESCE(notes, ''),
  'staging_import',
  'new'
FROM public.lead_staging
WHERE client_name IS NOT NULL AND client_phone IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.telephone_original = COALESCE(client_phone, '')
  );

-- ============================================================
-- 2. Set campaign call limit to 12 and clear blocking reason
-- ============================================================
UPDATE public.campaigns
SET provider_call_limit = 12,
    blocking_reason = '',
    updated_at = now()
WHERE id = (SELECT id FROM public.campaigns ORDER BY created_at DESC LIMIT 1);
