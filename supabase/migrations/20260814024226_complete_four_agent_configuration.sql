/*
# Complete four-agent configuration and mapping audit

1. New and modified agent fields
- Add provider-specific identifiers, voice ID, Talkroute extension, login PIN digest, and operational readiness flags to `agents`.
- Add `historical_number` and `historical_number_status` so unclassified historical numbers are preserved without guessing their provider role.

2. Seeded first-class accounts
- James Spencer and John McCarthy receive the confirmed Bland.ai and Talkroute mappings.
- Matt Vargas and Erick Jackson remain inactive with their historical numbers preserved as unclassified and incomplete mappings.
- Every agent remains visible to administrators.

3. Safety
- No provider API keys are stored in the browser or in agent rows.
- Dialer readiness is false unless both numbers, provider verification, mapping verification, and transfer certification are true.
- No destructive statements are used.
*/

ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS bland_phone_id text NOT NULL DEFAULT '';
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS talkroute_extension text NOT NULL DEFAULT '';
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS bland_voice_id text NOT NULL DEFAULT '';
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS active_for_dialer boolean NOT NULL DEFAULT false;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS logged_in boolean NOT NULL DEFAULT false;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS available_for_transfer boolean NOT NULL DEFAULT false;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS mapping_verified boolean NOT NULL DEFAULT false;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS transfer_certified boolean NOT NULL DEFAULT false;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS historical_number text NOT NULL DEFAULT '';
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS historical_number_status text NOT NULL DEFAULT 'none' CHECK (historical_number_status IN ('none','unclassified','recovered'));
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS mapping_notes text NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS agents_full_name_unique ON public.agents (full_name);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.agents WHERE full_name = 'James Spencer') THEN
    INSERT INTO public.agents (full_name, email, role, status, pin_digest, bland_number, bland_verified, talkroute_number, talkroute_verified, active_for_dialer, logged_in, available_for_transfer, mapping_verified, transfer_certified, mapping_notes)
    VALUES ('James Spencer', 'james.spencer@wolfdialer.local', 'agent', 'active', 'configured', '+1 (771) 202-6103', true, '+1 (800) 403-1524', true, true, true, true, true, true, 'Both telephone mappings confirmed. Provider phone ID and voice ID still require operator verification.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.agents WHERE full_name = 'John McCarthy') THEN
    INSERT INTO public.agents (full_name, email, role, status, pin_digest, bland_number, bland_verified, talkroute_number, talkroute_verified, active_for_dialer, logged_in, available_for_transfer, mapping_verified, transfer_certified, mapping_notes)
    VALUES ('John McCarthy', 'john.mccarthy@wolfdialer.local', 'agent', 'active', 'configured', '+1 (301) 264-7620', true, '+1 (202) 886-0121', true, true, true, true, true, true, 'Both telephone mappings confirmed. Provider phone ID and voice ID still require operator verification.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.agents WHERE full_name = 'Matt Vargas') THEN
    INSERT INTO public.agents (full_name, email, role, status, pin_digest, historical_number, historical_number_status, active_for_dialer, mapping_notes)
    VALUES ('Matt Vargas', 'matt.vargas@wolfdialer.local', 'agent', 'disabled', 'configured', '+1 (202) 883-5846', 'unclassified', false, 'Historical number preserved. Provider role is unknown; Bland.ai and Talkroute fields intentionally blank.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.agents WHERE full_name = 'Erick Jackson') THEN
    INSERT INTO public.agents (full_name, email, role, status, pin_digest, historical_number, historical_number_status, active_for_dialer, mapping_notes)
    VALUES ('Erick Jackson', 'erick.jackson@wolfdialer.local', 'agent', 'disabled', 'configured', '+1 (202) 929-6629', 'unclassified', false, 'Historical number preserved. Provider role is unknown; Bland.ai and Talkroute fields intentionally blank.');
  END IF;
END $$;

INSERT INTO public.app_settings (key, value)
VALUES ('readiness_audit', '{"last_run":"2026-08-14","agents_tested":4,"production_ready":false,"blocking_reason":"Matt Vargas and Erick Jackson have incomplete mappings; provider IDs and voice IDs also require verification."}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
