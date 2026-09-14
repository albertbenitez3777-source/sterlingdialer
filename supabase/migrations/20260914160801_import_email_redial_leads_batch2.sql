/*
# Import email redial leads batches 2-3

1. Data Import
   - Inserts remaining 284 leads from the found_emails CSV (rows 151-434)
   - Each lead has email stored in custom_fields for agent display
   - All status 'new' for immediate dialer pickup
   - Source: email_redial_import
   - Skips duplicates via ON CONFLICT DO NOTHING
*/

INSERT INTO leads (name, telephone_original, telephone_normalized, address, income_range, home_value, custom_fields, status, source, is_priority, retry_count) VALUES
  ('Armando De Molina', '9544370089', '+19544370089', '16335 SW 26th St Miramar, FL 33027', '', '', '{"email": "armando.demolina@i9sports.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Eduardo Henkel', '3052857020', '+13052857020', '1643 Brickell Ave Apt 3901 Miami, FL 33129', '', '', '{"email": "eduardo.henkel@azelis.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Mark Reinsch', '9043848001', '+19043848001', '2700 Lake Shore Blvd Jacksonville, FL 32210', '', '', '{"email": "m.reinsch@papmet.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Merle Townley', '3864262165', '+13864262165', '513 Boxwood Ln New Smyrna Beach, FL 32168', '', '', '{"email": "metownley@aol.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Robert Cowdery', '8506279023', '+18506279023', '246 Forest Dr N Havana, FL 32333', '', '', '{"email": "bobcowdery14822@gmail.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Alfred Dickerson', '7277841052', '+17277841052', '1975 Horse Shoe Bend Rd Dunedin, FL 34698', '', '', '{"email": "jodi1935@yahoo.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Mildred Adams', '3057581339', '+13057581339', '44 NW 93rd St Miami Shores, FL 33150', '', '', '{"email": "mildred.adams@msn.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Agatha Cayia', '3526943282', '+13526943282', '3895 SE 20th St Ocala, FL 34471', '', '', '{"email": "agatha.cayia@gmail.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Gordon Hubbell', '3523337778', '+13523337778', '1703 SW 82nd Dr Gainesville, FL 32607', '', '', '{"email": "floydhubbell@lycos.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Joseph Weber', '4242495500', '+14242495500', '131 N Gale Dr Beverly Hills, CA 90211', '', '', '{"email": "josephweber@earthlink.net"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Michael Gray', '9419250330', '+19419250330', '10711 Osprey Landing Way Riverview, FL 33578', '', '', '{"email": "michael.gray@myakka.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('David Fiorillo', '3212660488', '+13212660488', '1485 Admiralty Blvd Rockledge, FL 32955', '', '', '{"email": "dfiorillo@cfl.rr.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Michael Powe', '3529003037', '+13529003037', '5750 NE 13th Ln Ocala, FL 34470', '', '', '{"email": "powe@us.ibm.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Mary Barta', '7274530244', '+17274530244', '4805 81st Way N Kenneth City, FL 33709', '', '', '{"email": "marybarta_3@hotmail.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Pedro Diaz', '7863212662', '+17863212662', '13350 SW 21st Ln Miami, FL 33175', '', '', '{"email": "drtoro05@aol.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Terrence Finneran', '7277294141', '+17277294141', '9050 60th Way Pinellas Park, FL 33782', '', '', '{"email": "tpfinneran@gmail.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Mike Amalfi', '9543466662', '+19543466662', '15760 SW 53rd Ct Miramar, FL 33027', '', '', '{"email": "teamamalfi@comcast.net"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Karl Schwerin', '3212590068', '+13212590068', '5780 N Banana River Blvd Cocoa Beach, FL 32931', '', '', '{"email": "klschwerin@gmail.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Robert Sanchez', '7279374020', '+17279374020', '510 Greenfield Rd Winter Haven, FL 33884', '', '', '{"email": "rsanchez@sanchez-medina.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Richard Schock', '7274551791', '+17274551791', '4905 6th Ave N Saint Petersburg, FL 33713', '', '', '{"email": "dickschock1@yahoo.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Jacquelyn Porter', '7273426497', '+17273426497', '4121 Rudder Way New Port Richey, FL 34652', '', '', '{"email": "jackieporter2@yahoo.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Ann Whittle', '8506783313', '+18506783313', '123 S Baylen St Pensacola, FL 32502', '', '', '{"email": "annwhittle@aol.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Clarence Mcvey', '8504329003', '+18504329003', '5505 W Fairfield Dr Pensacola, FL 32506', '', '', '{"email": "rmcvey@cox.net"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Sharon Hefferon', '3522070120', '+13522070120', '2415 Burford Ln The Villages, FL 32162', '', '', '{"email": "sharonhefferon@aol.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Greg Jackson', '9133390500', '+19133390500', '7300 W 110th St Overland Park, KS 66210', '', '', '{"email": "gajackson@msn.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Roland Tey', '5122437290', '+15122437290', '11508 Oak Trl Austin, TX 78753', '', '', '{"email": "rtey@yahoo.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Edward Brock', '8173991306', '+18173991306', '426 Fountain Park Dr Euless, TX 76039', '', '', '{"email": "bachmeierj1@yahoo.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('John Dini', '2106151800', '+12106151800', '316 Mustang Cir San Antonio, TX 78232', '', '', '{"email": "jdini@mpninc.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Robert Huthnance', '5124512855', '+15124512855', '4001 Harbor Light Cv Austin, TX 78731', '', '', '{"email": "comdude@hotmail.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Lloyd Haggard', '9729915711', '+19729915711', '6115 Oakcrest Rd Dallas, TX 75248', '', '', '{"email": "pclhaggard33@tivejo.com"}'::jsonb, 'new', 'email_redial_import', false, 0)
ON CONFLICT DO NOTHING;
