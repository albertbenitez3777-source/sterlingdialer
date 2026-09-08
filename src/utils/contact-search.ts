type ContactFields = {
  email?: string;
  emails?: string[];
  custom_fields?: Record<string, unknown> | null;
};

export function contactEmails(contact: ContactFields): string[] {
  const candidates: unknown[] = [...(contact.emails || []), contact.email];
  for (const [key, value] of Object.entries(contact.custom_fields || {})) {
    if (/mail/i.test(key)) candidates.push(...(Array.isArray(value) ? value : [value]));
  }
  return [...new Set(candidates.filter((v): v is string => typeof v === 'string' && v.includes('@')).map(v => v.trim()).filter(Boolean))];
}

export function contactFieldText(value: unknown): string {
  if (value == null) return '';
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
}
