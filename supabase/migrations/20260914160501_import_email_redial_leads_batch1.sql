/*
# Import email redial leads batch 1 of 3

1. Data Import
   - Inserts 150 leads from the found_emails CSV into the leads table
   - Each lead has name, phone, address, and email stored in custom_fields jsonb
   - All leads set to status 'new' for immediate dialer pickup
   - Source tagged as 'email_redial_import' for tracking
   - ON CONFLICT DO NOTHING to skip any duplicates

2. Notes
   - Email is stored in custom_fields as {"email": "..."} for display in agent workspace
   - These are re-dial leads with verified email addresses
*/

INSERT INTO leads (name, telephone_original, telephone_normalized, address, income_range, home_value, custom_fields, status, source, is_priority, retry_count) VALUES
  ('Darrell Weeks', '2318564410', '+12318564410', '19490 5 Mile Rd Morley, MI 49336', '', '', '{"email": "weekstruckingandexcavating@hotmail.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Larry Spierer', '8283288422', '+18283288422', '465 44th Avenue Dr NW Hickory, NC 28601', '', '', '{"email": "lsp465@aol.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Shauna Lewis', '7186292427', '+17186292427', '540 E 43rd St Brooklyn, NY 11203', '', '', '{"email": "shapelyshauna@twcny.rr.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Theresa Caroselli', '5167427066', '+15167427066', '54 2nd St Garden City  NY 11530', '', '', '{"email": "tcaroselli@yahoo.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Denise Martin', '7273231893', '+17273231893', '5501 32nd Ave N Saint Petersburg, FL 33710', '', '', '{"email": "breannagrandma@yahoo.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Eugene Hester', '3526941880', '+13526941880', '721 SE 36th Ln Ocala, FL 34471', '', '', '{"email": "efhester@flash.net"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Bernhard Meister', '6172697354', '+16172697354', '501 E 3rd St Apt 1 South Boston, MA 02127', '', '', '{"email": "littlefoley09@aol.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Rick Lozon', '2697312408', '+12697312408', '6307 N 39th St Augusta, MI 49012', '', '', '{"email": "ricklozon@yahoo.com; ricklozon@gmail.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Joseph Cotruvo', '2023623076', '+12023623076', '5015 46th St NW Washington  DC 20016', '', '', '{"email": "joseph.cotruvo@verizon.net; josephcotruvo@yahoo.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Thomas Browne', '7187884263', '+17187884263', '446 5th St Brooklyn, NY 11215', '', '', '{"email": "brobor@aol.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Andrew Pinella', '7034658896', '+17034658896', '5943 3rd St N Arlington, VA 22203', '', '', '{"email": "jpinella@mindspring.com; andrewpinella@gmail.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Stanley Schachne', '9542369660', '+19542369660', '10101 SW 40th St Davie  FL 33328', '', '', '{"email": "contact@flbuilders.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Everett Lindberg', '3602569702', '+13602569702', '15612 NE 244th Ave Brush Prairie  WA 98606', '', '', '{"email": "elindberg@netzero.net"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Scott Lewis', '5032884356', '+15032884356', '2606 NE 38th Ave Portland, OR 97212', '', '', '{"email": "slewis@composent.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Kenneth Bottini', '4258839615', '+14258839615', '12835 NE 36th St Bellevue, WA 98005', '', '', '{"email": "cbottini@hotmail.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('John Strahle', '3217241605', '+13217241605', '216 4th Ave Melbourne Beach, FL 32951', '', '', '{"email": "mallorygrace330@gmail.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Nathan Judish', '7035344406', '+17035344406', '6408 30th St N Arlington, VA 22207', '', '', '{"email": "jjudish1@gmail.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Zev Bomrind', '7182523168', '+17182523168', '1420 E 26th St Brooklyn, NY 11210', '', '', '{"email": "zbomrind@gmail.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('James Ranfone', '7032372105', '+17032372105', '4930 33rd Rd N Arlington  VA 22207', '', '', '{"email": "jranfone@aga.org; ranfone1@aol.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Roger Fehrle', '6092631481', '+16092631481', '229 59th St Sea Isle City, NJ 08243', '', '', '{"email": "cardy151@yahoo.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Kurt Graffy', '4157522409', '+14157522409', '538 47th Ave San Francisco, CA 94121', '', '', '{"email": "kgraffy@worldnet.att.net"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Ken Mcdowell', '4257885590', '+14257885590', '16328 234th St SE Monroe, WA 98272', '', '', '{"email": "kmcdowell@woodinvillewater.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Jerry Huizenga', '6052662795', '+16052662795', '19455 391st Ave Hitchcock, SD 57348', '', '', '{"email": "huizenga_35@hotmail.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Steven Jaton', '6055864344', '+16055864344', '45562 224th St Nunda, SD 57050', '', '', '{"email": "svjaton@itcel.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Benjamin Rousu', '7632767480', '+17632767480', '5490 57th St SE Delano, MN 55328', '', '', '{"email": "brousu@aol.com; benjaminr4912@msn.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Richard Liebman', '9183571232', '+19183571232', '16407 E 47th Pl Tulsa, OK 74134', '', '', '{"email": "richard.liebman@yahoo.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Dennis Kasparbauer', '7126533634', '+17126533634', '3061 370th St Manning, IA 51455', '', '', '{"email": "moe_kasparbauer@hotmail.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Tommy Gertner', '9183573615', '+19183573615', '6833 S 302nd East Ave Broken Arrow, OK 74014', '', '', '{"email": "trgertner@yahoo.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Alvin Callaway', '7852734509', '+17852734509', '6942 SW 33rd St Topeka, KS 66614', '', '', '{"email": "al.callaway@comcast.net"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Marvin Vis', '7124392839', '+17124392839', '1322 2nd St Hull, IA 51239', '', '', '{"email": "mvis@hotmail.com; cosmo764@hotmail.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('John Chadwick', '7157434519', '+17157434519', '920 W 5th St Neillsville, WI 54456', '', '', '{"email": "whisperingj@yahoo.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Chad Henrichs', '5078434020', '+15078434020', '56862 402nd Ave Mazeppa, MN 55956', '', '', '{"email": "chadh2560@yahoo.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Lynn Anderson', '5077235835', '+15077235835', '15118 400th Ave Springfield, MN 56087', '', '', '{"email": "anderson4boys@gmail.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Clyde Sprank', '5638722012', '+15638722012', '17136 413th Ave Bellevue, IA 52031', '', '', '{"email": "jlatt800@gmail.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Louis Zuccaro', '4804733794', '+14804733794', '27006 N 73rd St Scottsdale, AZ 85266', '', '', '{"email": "louis.zuccaro@hotmail.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('George Saffo', '2127221455', '+12127221455', '19 E 88th St Apt 4g New York, NY 10128', '', '', '{"email": "gvsclick@gmail.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Leon Avila', '3056678730', '+13056678730', '8220 SW 62nd Ave South Miami, FL 33143', '', '', '{"email": "iravila@avilains.com; santatecla10@aol.com; avilains@aol.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Paul Gourvitz', '6464142195', '+16464142195', '30 W 63rd St Apt 3k New York, NY 10023', '', '', '{"email": "paul@gourvitzcommunications.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Mark Ravitz', '7187687619', '+17187687619', '200 7th Ave Brooklyn, NY 11215', '', '', '{"email": "sharonravitz@gmail.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Joseph Concannon', '3522057709', '+13522057709', '16750 SE 80th Bellavista Cir Lady Lake, FL 32162', '', '', '{"email": "econcannon1@aol.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('John Troia', '9547579617', '+19547579617', '12698 NW 9th Ct Coral Springs, FL 33071', '', '', '{"email": "john.troia@wmconnect.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Petros Matiatos', '7184914034', '+17184914034', '1146 76th St Brooklyn, NY 11228', '', '', '{"email": "pmatiatos@msn.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Donald Levison', '4157535206', '+14157535206', '1630 8th Ave San Francisco, CA 94122', '', '', '{"email": "dlevison@earthlink.net; donlevison@yahoo.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Edward Fisher', '4254546446', '+14254546446', '1700 92nd Ave NE Clyde Hill, WA 98004', '', '', '{"email": "fisherel@msn.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Fuller Ehlen', '2538484597', '+12538484597', '11208 94th Ave E Puyallup, WA 98373', '', '', '{"email": "office@efdds.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Dale Wood', '9183693509', '+19183693509', '11101 S 90th East Ave Bixby, OK 74008', '', '', '{"email": "dwood@olp.net"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Alan Carlton', '9183695066', '+19183695066', '10770 S 77th East Ave Tulsa, OK 74133', '', '', '{"email": "alanandcarolyn@cox.net"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Mitchell Mccranie', '6052945396', '+16052945396', '11747 407th Ave Claremont  SD 57432', '', '', '{"email": "mitch_5822@hotmail.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Levi Richmond', '9183332173', '+19183332173', '395290 W 2400 Rd Ochelata, OK 74051', '', '', '{"email": "richmondconst1@aol.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Gary Dovico', '6416622924', '+16416622924', '1046 220th St Batavia, IA 52533', '', '', '{"email": "debbiesylvester@msn.com"}'::jsonb, 'new', 'email_redial_import', false, 0),
  ('Esmail Sodha', '6307343217', '+16307343217', '3115 38th St Oak Brook  IL 60523', '', '', '{"email": "saleem.mirza@yahoo.com"}'::jsonb, 'new', 'email_redial_import', false, 0)
ON CONFLICT DO NOTHING;
