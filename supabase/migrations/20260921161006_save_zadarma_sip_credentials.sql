/*
# Save Zadarma SIP Credentials for All Agents

1. Modified Tables
   - `agents`: Updated `zadarma_sip_login` and `zadarma_sip_password` for James, Erick, and Mark
   
2. Credential Mapping
   - James Spencer (ext 100): 566918-100
   - Erick Jackson (ext 101): 566918-101
   - Mark Carlson (ext 102): 566918-102
   
3. SIP Server: pbx.zadarma.com (used by IPhone component)
*/

-- James Spencer -> Extension 100
UPDATE agents
SET zadarma_sip_login    = '566918-100',
    zadarma_sip_password = 'dC4ip5c7Xn'
WHERE id = 'c242abef-c01e-490b-bab6-859cd89bd08a';

-- Erick Jackson -> Extension 101
UPDATE agents
SET zadarma_sip_login    = '566918-101',
    zadarma_sip_password = 'c2MitK8rv6'
WHERE id = 'bf021c46-10ca-45a4-b800-08f5e181834e';

-- Mark Carlson -> Extension 102
UPDATE agents
SET zadarma_sip_login    = '566918-102',
    zadarma_sip_password = 'bGvfz983Vr'
WHERE id = '03f30cd4-b21e-4a40-a611-df6cfd49d0ff';
