SET lock_timeout='3s';
ALTER TABLE federal_one_login_private.retired_pins DROP CONSTRAINT retired_pins_pkey;
ALTER TABLE federal_one_login_private.retired_pins ADD CONSTRAINT retired_pins_pkey PRIMARY KEY (agent_id,pin_digest,pin_salt);
COMMENT ON TABLE federal_one_login_private.retired_pins IS 'Retired salted PIN fingerprints retained across rotations; backend access only. Never return these fingerprints to clients.';

