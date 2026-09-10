export function contactEmails(contact: { email?: string; emails?: string[]; custom_fields?: Record<string, unknown> | null }): string[] {
  const result: string[] = [];
  if (contact.email) result.push(contact.email);
  if (contact.emails) result.push(...contact.emails);
  if (contact.custom_fields) {
    for (const [key, val] of Object.entries(contact.custom_fields)) {
      if (/email/i.test(key) && typeof val === 'string' && val.includes('@')) {
        if (!result.includes(val)) result.push(val);
      }
    }
  }
  return [...new Set(result)];
}

export function contactFieldText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(contactFieldText).join(', ');
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return '[object]'; }
  }
  return String(value);
}
