-- Add inbound_configured column to track which agents have Elizabeth's inbound script active
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS inbound_configured boolean NOT NULL DEFAULT false;
