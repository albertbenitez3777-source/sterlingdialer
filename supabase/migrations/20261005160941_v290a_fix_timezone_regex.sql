/*
# v290a — Fix timezone inference regex patterns

The regex in infer_us_timezone used alternation incorrectly for PostgreSQL.
This replaces the patterns with simpler "contains" checks that work correctly.
*/

CREATE OR REPLACE FUNCTION public.infer_us_timezone(p_address text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_address IS NULL OR trim(p_address) = '' THEN 'America/New_York'
    WHEN lower(p_address) LIKE '% hi%' OR lower(p_address) LIKE '%hawaii%' OR lower(p_address) LIKE '%hawai%' THEN 'Pacific/Honolulu'
    WHEN lower(p_address) LIKE '% ak%' OR lower(p_address) LIKE '%alaska%' THEN 'America/Anchorage'
    WHEN lower(p_address) LIKE '% wa%' OR lower(p_address) LIKE '% or%' OR lower(p_address) LIKE '% ca%'
      OR lower(p_address) LIKE '% nv%' OR lower(p_address) LIKE '% az%'
      OR lower(p_address) LIKE '%los angeles%' OR lower(p_address) LIKE '%san francisco%'
      OR lower(p_address) LIKE '%seattle%' OR lower(p_address) LIKE '%portland%'
      OR lower(p_address) LIKE '%phoenix%' OR lower(p_address) LIKE '%las vegas%'
      THEN 'America/Los_Angeles'
    WHEN lower(p_address) LIKE '% co%' OR lower(p_address) LIKE '% ut%' OR lower(p_address) LIKE '% id%'
      OR lower(p_address) LIKE '% wy%' OR lower(p_address) LIKE '% nm%' OR lower(p_address) LIKE '% mt%'
      OR lower(p_address) LIKE '%denver%' OR lower(p_address) LIKE '%salt lake%'
      OR lower(p_address) LIKE '%boise%' OR lower(p_address) LIKE '%cheyenne%'
      THEN 'America/Denver'
    WHEN lower(p_address) LIKE '% tx%' OR lower(p_address) LIKE '% ok%' OR lower(p_address) LIKE '% ks%'
      OR lower(p_address) LIKE '% ne%' OR lower(p_address) LIKE '% sd%' OR lower(p_address) LIKE '% nd%'
      OR lower(p_address) LIKE '% mn%' OR lower(p_address) LIKE '% ia%' OR lower(p_address) LIKE '% mo%'
      OR lower(p_address) LIKE '% ar%' OR lower(p_address) LIKE '% la%' OR lower(p_address) LIKE '% wi%'
      OR lower(p_address) LIKE '% il%' OR lower(p_address) LIKE '% ms%' OR lower(p_address) LIKE '% al%'
      OR lower(p_address) LIKE '%chicago%' OR lower(p_address) LIKE '%houston%' OR lower(p_address) LIKE '%dallas%'
      OR lower(p_address) LIKE '%new orleans%' OR lower(p_address) LIKE '%memphis%' OR lower(p_address) LIKE '%nashville%'
      OR lower(p_address) LIKE '%minneapolis%'
      THEN 'America/Chicago'
    WHEN lower(p_address) LIKE '% fl%' OR lower(p_address) LIKE '% ga%' OR lower(p_address) LIKE '% sc%'
      OR lower(p_address) LIKE '% nc%' OR lower(p_address) LIKE '% va%' OR lower(p_address) LIKE '% dc%'
      OR lower(p_address) LIKE '% md%' OR lower(p_address) LIKE '% de%' OR lower(p_address) LIKE '% nj%'
      OR lower(p_address) LIKE '% ny%' OR lower(p_address) LIKE '% ct%' OR lower(p_address) LIKE '% ri%'
      OR lower(p_address) LIKE '% ma%' OR lower(p_address) LIKE '% vt%' OR lower(p_address) LIKE '% nh%'
      OR lower(p_address) LIKE '% me%' OR lower(p_address) LIKE '% pa%' OR lower(p_address) LIKE '% oh%'
      OR lower(p_address) LIKE '% mi%' OR lower(p_address) LIKE '% in%' OR lower(p_address) LIKE '% ky%'
      OR lower(p_address) LIKE '% tn%' OR lower(p_address) LIKE '% wv%'
      OR lower(p_address) LIKE '%miami%' OR lower(p_address) LIKE '%atlanta%'
      OR lower(p_address) LIKE '%new york%' OR lower(p_address) LIKE '%boston%'
      OR lower(p_address) LIKE '%philadelphia%' OR lower(p_address) LIKE '%detroit%'
      THEN 'America/New_York'
    ELSE 'America/New_York'
  END;
$function$;
