/*
# V247 — Fix ensure_transfer_live: Remove Premature Bridge Confirmation

## Problem
V245's ensure_transfer_live() incorrectly set bridge_confirmed := true whenever
talkroute_leg_created was true. A Talkroute leg being created only means the
destination is ringing — it does NOT prove a human answered. This caused calls
to be incorrectly marked as bridged before any representative actually spoke.

## Fix
ensure_transfer_live() now ONLY sets is_live_human = true when:
  - talkroute_leg_created = true (destination is ringing, so agent should see the call)
  - OR transcript contains the exact transfer phrase "connecting you now"

It must NEVER set any of these fields (bridge proof must come from the webhook's
evaluateTransferState logic based on representative speech or MERGED state):
  - bridge_confirmed
  - bridge_confirmed_at
  - talkroute_answered
  - transfer_status = 'successful'
  - queue = 'fire_transfer'
  - transfer_state = 'bridge_ended'

## Bridge Proof Sources (unchanged, in webhook only)
  - Representative speech: speaker_label normalized to exactly "representative",
    or speaker numeric/string "2" with non-empty text
  - Warm-transfer MERGED state from provider

## Important Notes
1. Campaign state is NOT changed — remains stopped
2. No data is modified on existing call rows
3. This is idempotent (CREATE OR REPLACE + DROP/CREATE trigger)
*/

CREATE OR REPLACE FUNCTION public.ensure_transfer_live()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Talkroute leg created = destination is ringing, agent should see the call.
  -- This is NOT bridge proof — do NOT set bridge_confirmed, talkroute_answered,
  -- transfer_status, queue, or transfer_state here.
  IF COALESCE(NEW.talkroute_leg_created, false) THEN
    NEW.is_live_human := true;
  ELSIF COALESCE(NEW.transcript, '') ILIKE '%connecting you now%' THEN
    NEW.is_live_human := true;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS ensure_transfer_live_stats ON public.calls;
CREATE TRIGGER ensure_transfer_live_stats
  BEFORE INSERT OR UPDATE ON public.calls
  FOR EACH ROW EXECUTE FUNCTION public.ensure_transfer_live();
