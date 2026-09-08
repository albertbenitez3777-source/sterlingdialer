#!/usr/bin/env python3
"""
Generate leads-import.sql from a CSV with headers:
  Annual Income, Home Value, Address, Full Name, Telephone Number, Email
"""

import csv
import re
import sys
import json

JAMES_ID = 'c242abef-c01e-490b-bab6-859cd89bd08a'
SOURCE = 'email_batch_20'
PRIORITY_BATCH_ID = 'email_batch_20_james'

def escape_sql(val):
    """Escape single quotes for SQL by doubling them."""
    if val is None:
        return None
    return val.replace("'", "''")

def normalize_phone(raw):
    """Strip non-digits; if 10 digits prefix +1, if 11+ prefix +."""
    if not raw:
        return None, None
    digits = re.sub(r'\D', '', raw)
    if not digits:
        return None, None
    original = digits
    if len(digits) == 10:
        normalized = '+1' + digits
    elif len(digits) >= 11:
        normalized = '+' + digits
    else:
        normalized = '+' + digits
    return original, normalized

def sql_str_or_null(val):
    """Return 'escaped_val' or NULL."""
    if val is None or val.strip() == '':
        return 'NULL'
    return "'" + escape_sql(val.strip()) + "'"

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 generate_leads_sql.py <input.csv>", file=sys.stderr)
        sys.exit(1)

    input_file = sys.argv[1]
    output_file = '/tmp/leads-import.sql'

    rows = []
    skipped = 0

    with open(input_file, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        reader.fieldnames = [h.strip() for h in reader.fieldnames]

        for row in reader:
            name = row.get('Full Name', '').strip()
            phone_raw = row.get('Telephone Number', '').strip()
            address = row.get('Address', '').strip()
            income = row.get('Annual Income', '').strip()
            home_value = row.get('Home Value', '').strip()
            email = row.get('Email', '').strip()

            if not name or not phone_raw:
                skipped += 1
                continue

            original, normalized = normalize_phone(phone_raw)
            if not original:
                skipped += 1
                continue

            custom_fields = {}
            if email:
                custom_fields['email'] = email
            custom_fields_json = json.dumps(custom_fields)

            rows.append({
                'name': name,
                'telephone_original': original,
                'telephone_normalized': normalized,
                'address': address,
                'income_range': income if income else None,
                'home_value': home_value if home_value else None,
                'email': email,
                'custom_fields_json': custom_fields_json,
            })

    total = len(rows)
    lines = []
    lines.append(f'-- Total rows: {total} (skipped {skipped} rows with missing name or phone)')
    lines.append('')
    lines.append('INSERT INTO leads (id, assigned_agent_id, name, telephone_original, telephone_normalized, address, income_range, home_value, property_information, notes, original_agent_information, source, custom_fields, status, is_priority, priority_batch_id)')
    lines.append('VALUES')

    value_lines = []
    for r in rows:
        name_sql = escape_sql(r['name'])
        tel_orig = escape_sql(r['telephone_original'])
        tel_norm = escape_sql(r['telephone_normalized'])
        address_sql = sql_str_or_null(r['address'])
        income_sql = sql_str_or_null(r['income_range'])
        home_val_sql = sql_str_or_null(r['home_value'])
        cf_json = escape_sql(r['custom_fields_json'])

        val = (
            f"(gen_random_uuid(), '{JAMES_ID}', '{name_sql}', '{tel_orig}', '{tel_norm}', "
            f"{address_sql}, {income_sql}, {home_val_sql}, NULL, NULL, NULL, "
            f"'{SOURCE}', '{cf_json}'::jsonb, 'new', true, '{PRIORITY_BATCH_ID}')"
        )
        value_lines.append(val)

    for i, vl in enumerate(value_lines):
        if i < len(value_lines) - 1:
            lines.append(vl + ',')
        else:
            lines.append(vl)

    lines.append(';')
    lines.append('')

    with open(output_file, 'w', encoding='utf-8') as out:
        out.write('\n'.join(lines))

    print(f"Written {total} rows to {output_file} (skipped {skipped})")

if __name__ == '__main__':
    main()
