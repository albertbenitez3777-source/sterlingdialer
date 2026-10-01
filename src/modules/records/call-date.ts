const zone = 'America/Costa_Rica';
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFormat = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function dayKey(date: Date) {
  const parts = dayFormat.formatToParts(date);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-');
}

export function callDateDetails(timestamp: string, now = new Date()) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return { isToday: false, period: 'Unknown date', label: 'Call time unavailable' };
  const day = dayKey(date);
  const today = dayKey(now);
  const isToday = day === today;
  const period = isToday ? 'Today' : day < today ? 'Earlier call' : 'Future timestamp';
  return { isToday, period, label: `${period} · ${timeFormat.format(date)} CR` };
}
