/*
# Update check constraints for owner role, archived status, and historical number statuses

## Changes
1. Allows 'owner' in role check constraint
2. Allows 'archived' in status check constraint
3. Allows 'replaced_by_production_mapping', 'historical_naming_conflict', 'historical_talkroute_conflict' in historical_number_status
*/

ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS agents_role_check;
ALTER TABLE public.agents ADD CONSTRAINT agents_role_check
  CHECK (role = ANY (ARRAY['owner'::text, 'administrator'::text, 'supervisor'::text, 'agent'::text]));

ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS agents_status_check;
ALTER TABLE public.agents ADD CONSTRAINT agents_status_check
  CHECK (status = ANY (ARRAY['active'::text, 'disabled'::text, 'pending'::text, 'archived'::text]));

ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS agents_historical_number_status_check;
ALTER TABLE public.agents ADD CONSTRAINT agents_historical_number_status_check
  CHECK (historical_number_status = ANY (ARRAY[
    'none'::text, 'unclassified'::text, 'recovered'::text,
    'replaced_by_production_mapping'::text,
    'historical_naming_conflict'::text,
    'historical_talkroute_conflict'::text
  ]));
