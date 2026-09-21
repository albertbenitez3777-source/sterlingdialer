-- Match the canonical phone lookup used by import_leads without scanning every lead.
CREATE INDEX IF NOT EXISTS leads_import_phone_normalized_idx
  ON public.leads (public.normalize_phone(telephone_normalized));
