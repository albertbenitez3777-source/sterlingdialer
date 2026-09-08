export function maskPhone(phone: string): string {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '••••';
  const last4 = digits.slice(-4);
  return `•••• ${last4}`;
}

export function formatPhone(phone: string): string {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

export function maskAddress(address: string): string {
  if (!address) return '—';
  const parts = address.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length <= 1) {
    return parts[0]?.slice(0, 8) + '…' || '—';
  }
  return parts.slice(1).join(', ');
}

export function maskAddressCoarse(address: string): string {
  if (!address) return '—';
  const parts = address.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length <= 1) return 'Address on file';
  return parts.slice(1).join(', ');
}
