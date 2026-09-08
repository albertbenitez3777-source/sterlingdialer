import { readFileSync } from 'fs';

const envText = readFileSync('.env', 'utf8');
const vars = {};
for (const line of envText.split('\n')) {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m) vars[m[1].trim()] = m[2].trim();
}

const supabaseUrl = vars.VITE_SUPABASE_URL;
const anonKey = vars.VITE_SUPABASE_ANON_KEY;

const csv = readFileSync('data/Recipe_1_JULY_77___679977269_2.csv', 'utf8');
console.log(`CSV size: ${csv.length} bytes, ${csv.split('\n').length} lines`);

const url = `${supabaseUrl}/functions/v1/wolf-import-leads`;
console.log(`Calling: ${url}`);

const resp = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${anonKey}`,
    'apikey': anonKey,
  },
  body: JSON.stringify({
    csv_data: csv,
    source: 'recipe1_sept2026',
    skip_existing: true,
  }),
});

console.log(`Status: ${resp.status}`);
const result = await resp.json();
console.log('Result:', JSON.stringify(result, null, 2));
