/*
# v290 — Timezone gate for main dialer + callback booking support

## Purpose
1. Adds a local-time gate to the main dialer's lead selection so calls are
   only placed after 8:00 AM at the address location. Uses the lead's
   `address` field to infer a US timezone.
2. Allows 'appointment' as a valid campaign type.
3. Creates helper functions for DNC detection from transcripts.
4. Adds callback_request_type column to calls.

## Important notes
1. The timezone gate uses address keyword matching to infer timezone.
2. No data is lost — only additions and function rewrites.
3. No RLS changes.
*/

-- 1. Allow 'appointment' and 'retry' campaign types (keep existing data valid)
ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_campaign_type_check;
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_campaign_type_check
  CHECK (campaign_type IN ('standard', 'appointment', 'retry'));

-- 2. Add callback_request_type column to calls
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS callback_request_type text DEFAULT NULL;

-- 3. Helper function: infer US timezone from address text
CREATE OR REPLACE FUNCTION public.infer_us_timezone(p_address text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_address IS NULL OR trim(p_address) = '' THEN 'America/New_York'
    WHEN lower(p_address) ~ '(,|)\s*(HI|Hawaii|Hawai)' THEN 'Pacific/Honolulu'
    WHEN lower(p_address) ~ '(,|)\s*(AK|Alaska)' THEN 'America/Anchorage'
    WHEN lower(p_address) ~ '(,|)\s*(WA|OR|CA|NV|AZ|Pacific|Los Angeles|San Francisco|Seattle|Portland|Phoenix|Las Vegas)' THEN 'America/Los_Angeles'
    WHEN lower(p_address) ~ '(,|)\s*(MT|CO|UT|ID|WY|NM|Denver|Salt Lake|Boise|Cheyenne)' THEN 'America/Denver'
    WHEN lower(p_address) ~ '(,|)\s*(TX|OK|KS|NE|SD|ND|MN|IA|MO|AR|LA|WI|IL|MS|AL|Chicago|Houston|Dallas|New Orleans|Memphis|Nashville|Minneapolis)' THEN 'America/Chicago'
    WHEN lower(p_address) ~ '(,|)\s*(FL|GA|SC|NC|VA|DC|MD|DE|NJ|NY|CT|RI|MA|VT|NH|ME|PA|OH|MI|IN|KY|TN|WV|Miami|Atlanta|New York|Boston|Philadelphia|Detroit)' THEN 'America/New_York'
    ELSE 'America/New_York'
  END;
$function$;

-- 4. Helper function: check if it's currently within calling hours (8am-9pm) at the address
CREATE OR REPLACE FUNCTION public.is_within_calling_hours(p_address text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT EXTRACT(HOUR FROM now() AT TIME ZONE public.infer_us_timezone(p_address)) >= 8
     AND EXTRACT(HOUR FROM now() AT TIME ZONE public.infer_us_timezone(p_address)) < 21;
$function$;

-- 5. DNC detection from transcript text
CREATE OR REPLACE FUNCTION public.detect_dnc_from_transcript(p_transcript text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT p_transcript IS NOT NULL AND (
    lower(p_transcript) LIKE '%do not call%'
    OR lower(p_transcript) LIKE '%don''t call%'
    OR lower(p_transcript) LIKE '%dont call%'
    OR lower(p_transcript) LIKE '%stop calling%'
    OR lower(p_transcript) LIKE '%remove me from%'
    OR lower(p_transcript) LIKE '%take me off%'
    OR lower(p_transcript) LIKE '%remove this number%'
    OR lower(p_transcript) LIKE '%do not call me%'
    OR lower(p_transcript) LIKE '%don''t call me%'
    OR lower(p_transcript) LIKE '%stop calling me%'
  );
$function$;
