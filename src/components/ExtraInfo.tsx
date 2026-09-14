import { useMemo, useState } from 'react';
import { Search, Save, ExternalLink, RefreshCw } from 'lucide-react';
import { authFetch } from '@/utils/auth-fetch';
import './ExtraInfo.css';

type Source = { id: string; name: string; group: string; url: string };
type Known = { emails: string[]; phones: string[]; addresses: string[]; associates: string[]; records_checked: number };
type Finding = { id: string; source_name: string; source_url: string; finding_value: string; finding_type: string };

const API = () => `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/federal-one-v2`;
const q = (value: string) => encodeURIComponent(value);
const slug = (value: string) => value.trim().split(/\s+/).map(part => part.replace(/[^a-zA-Z0-9]/g, '')).filter(Boolean).join('-');
const dashedPhone = (phone: string) => {
  const digits = phone.replace(/\D/g, '').slice(-10);
  return digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : '';
};

export function parseClientBlob(raw: string) {
  const spaced = raw.replace(/([A-Za-z])\(/g, '$1 (').replace(/[·•|,]/g, ' ');
  const text = spaced.replace(/\s+/g, ' ').trim();
  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const email = emailMatch?.[0] || '';
  const phoneMatch = text.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  const phone = phoneMatch?.[0] || '';
  const withoutPhone = (phone ? text.replace(phone, ' ') : text).replace(email, ' ').replace(/\s+/g, ' ').trim();
  const addressMatch = withoutPhone.match(/\d{1,6}\s+[A-Za-z][A-Za-z0-9.'#\-\s]+(?:FL|Florida|[A-Z]{2})\s+\d{5}(?:-\d{4})?/i);
  const address = addressMatch?.[0]?.replace(/\s+/g, ' ').trim() || '';
  let name = withoutPhone;
  if (address) name = name.replace(address, ' ');
  name = name.replace(/\b(FL|NY|TX|CA|USA)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  const parts = name.split(' ').filter(Boolean);
  if (parts[0] && /^[A-Z]{1,2}$/.test(parts[0]) && parts.length >= 2) name = parts.slice(1).join(' ');
  return { name: name.trim(), phone, address, email };
}

export function buildPublicSources(name: string, phone: string, email: string, address: string): Source[] {
  const identity = [`"${name}"`, phone ? `"${phone}"` : '', address ? `"${address}"` : '', email ? `"${email}"` : ''].filter(Boolean).join(' ');
  const nameSlug = slug(name);
  const phoneSlug = dashedPhone(phone);
  const addressSlug = slug(address);
  const links: Source[] = [];
  if (nameSlug) links.push({ id: 'thatsthem_name', name: "That's Them — name", group: 'People search', url: `https://thatsthem.com/name/${nameSlug}` });
  if (phoneSlug) links.push({ id: 'thatsthem_phone', name: "That's Them — phone", group: 'People search', url: `https://thatsthem.com/phone/${phoneSlug}` });
  if (addressSlug) links.push({ id: 'thatsthem_address', name: "That's Them — address", group: 'People search', url: `https://thatsthem.com/address/${addressSlug}` });
  if (email) links.push({ id: 'thatsthem_email', name: "That's Them — email", group: 'People search', url: `https://thatsthem.com/email/${q(email)}` });
  if (identity) {
    links.push({ id: 'google', name: 'Google — full file', group: 'Web', url: `https://www.google.com/search?q=${q(identity)}` });
    links.push({ id: 'google_prev', name: 'Google — previous addresses', group: 'History', url: `https://www.google.com/search?q=${q(`${identity} "previous address" OR formerly OR "used to live" OR "property records"`)}` });
    links.push({ id: 'google_email', name: 'Google — emails', group: 'Email', url: `https://www.google.com/search?q=${q(`${identity} email "@" OR contact`)}` });
    links.push({ id: 'google_spouse', name: 'Google — spouse / relatives', group: 'Relationships', url: `https://www.google.com/search?q=${q(`${identity} spouse OR wife OR husband OR married OR relative`)}` });
    links.push({ id: 'bing', name: 'Bing', group: 'Web', url: `https://www.bing.com/search?q=${q(identity)}` });
  }
  if (name) {
    const city = address ? `&citystatezip=${q(address)}` : '';
    links.push({ id: 'truepeople', name: 'TruePeopleSearch', group: 'People search', url: `https://www.truepeoplesearch.com/results?name=${q(name)}${city}` });
    links.push({ id: 'fastpeople', name: 'FastPeopleSearch', group: 'People search', url: `https://www.fastpeoplesearch.com/name/${nameSlug}` });
    links.push({ id: 'familytree', name: 'FamilyTreeNow', group: 'People search', url: `https://www.familytreenow.com/search/genealogy/results?q=${q(name)}` });
    links.push({ id: 'searchpeoplefree', name: 'SearchPeopleFree', group: 'People search', url: `https://www.searchpeoplefree.com/find/${nameSlug}` });
    links.push({ id: 'cyber', name: 'CyberBackgroundChecks', group: 'People search', url: `https://www.cyberbackgroundchecks.com/people/${nameSlug}` });
  }
  if (phoneSlug) {
    links.push({ id: 'truepeople_phone', name: 'TruePeopleSearch — phone', group: 'Identity', url: `https://www.truepeoplesearch.com/results?phoneno=(${phoneSlug.slice(0, 3)})${phoneSlug.slice(4, 7)}-${phoneSlug.slice(8)}` });
    links.push({ id: 'fastpeople_phone', name: 'FastPeopleSearch — phone', group: 'Identity', url: `https://www.fastpeoplesearch.com/${phoneSlug}` });
  }
  return links;
}

export function ExtraInfo({
  sessionToken, onUnauthorized, initialName = '', initialPhone = '', initialAddress = '', initialEmail = '', compact = false,
}: {
  sessionToken: string;
  onUnauthorized: () => void;
  initialName?: string;
  initialPhone?: string;
  initialAddress?: string;
  initialEmail?: string;
  compact?: boolean;
}) {
  const seed = [initialName, initialPhone, initialAddress, initialEmail].filter(Boolean).join(' · ');
  const [blob, setBlob] = useState(seed);
  const parsed = useMemo(() => parseClientBlob(blob), [blob]);
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('Paste the line you already have. Do not search the file first.');
  const [sources, setSources] = useState<Source[]>([]);
  const [known, setKnown] = useState<Known | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);

  const run = async (openTabs = false) => {
    const next = parseClientBlob(blob);
    if (!next.name) { setNotice('Need a name. Example: Mary Deeb (727) 372-7375 · 10507 Alico Pass New Port Richey, FL 34655'); return; }
    const local = buildPublicSources(next.name, next.phone, next.email, next.address);
    setSources(local);
    setNotice(`${local.length} public searches ready for ${next.name}. Open That's Them and Google — results are on those sites, not inside Federal One.`);
    if (openTabs) {
      local.filter(s => s.id === 'thatsthem_name' || s.id === 'thatsthem_phone' || s.id === 'google' || s.id === 'google_prev').slice(0, 4)
        .forEach(s => window.open(s.url, '_blank', 'noopener,noreferrer'));
    }
    if (!sessionToken) return;
    setBusy(true);
    const result = await authFetch<{ research: { sources: Source[]; known?: Known } }>(API(), {
      onUnauthorized,
      body: { action: 'start_source_search', session_token: sessionToken, client_name: next.name, client_phone: next.phone, client_email: next.email, client_address: next.address },
    });
    const findingsResult = await authFetch<{ findings: Finding[] }>(API(), {
      onUnauthorized,
      body: { action: 'get_source_findings', session_token: sessionToken, client_name: next.name, client_phone: next.phone },
    });
    if (result.ok && result.data?.research?.sources?.length) {
      const merged = [...local];
      result.data.research.sources.forEach(source => { if (!merged.some(item => item.url === source.url)) merged.push(source); });
      setSources(merged);
      setKnown(result.data.research.known || null);
    }
    if (findingsResult.ok) setFindings(findingsResult.data?.findings || []);
    setBusy(false);
  };

  const saveExtra = async () => {
    const next = parseClientBlob(blob);
    if (!next.name || !extra.trim()) { setNotice('Name and extra info are required to save.'); return; }
    setBusy(true);
    const result = await authFetch<{ finding: Finding }>(API(), {
      onUnauthorized,
      body: {
        action: 'save_source_finding', session_token: sessionToken,
        client_name: next.name, client_phone: next.phone,
        source_name: 'Extra Info', source_url: sources[0]?.url || 'https://thatsthem.com/',
        finding_type: 'other', finding_value: extra.trim(),
      },
    });
    if (result.ok) {
      setExtra('');
      setNotice('Extra info saved to this client file.');
      const findingsResult = await authFetch<{ findings: Finding[] }>(API(), {
        onUnauthorized,
        body: { action: 'get_source_findings', session_token: sessionToken, client_name: next.name, client_phone: next.phone },
      });
      if (findingsResult.ok) setFindings(findingsResult.data?.findings || []);
    } else setNotice(result.error || 'Could not save extra info.');
    setBusy(false);
  };

  return (
    <section className={`extra-info ${compact ? 'compact' : ''}`} aria-label="Extra client information">
      <header>
        <small>EXTRA CLIENT INFORMATION</small>
        <h2>Find more while they are on the phone</h2>
        <p>Paste name, phone, and address in one box. You do not need to find them in Federal One first. We open That's Them and Google with that file. Paste emails, old addresses, or spouse names back here.</p>
      </header>
      <label className="extra-paste">Paste the whole line
        <textarea
          value={blob}
          onChange={e => setBlob(e.target.value)}
          maxLength={500}
          placeholder="Mary Deeb (727) 372-7375 · 10507 Alico Pass New Port Richey, FL 34655"
        />
      </label>
      <div className="extra-parsed">
        <span>Name <strong>{parsed.name || '—'}</strong></span>
        <span>Phone <strong>{parsed.phone || '—'}</strong></span>
        <span>Address <strong>{parsed.address || '—'}</strong></span>
      </div>
      <div className="extra-actions">
        <button type="button" onClick={() => void run(false)} disabled={busy}>{busy ? <RefreshCw size={15} className="spin" /> : <Search size={15} />} Prepare searches</button>
        <button type="button" className="extra-open" onClick={() => void run(true)} disabled={busy}><ExternalLink size={15} /> Open That's Them + Google now</button>
      </div>
      {known && (
        <div className="extra-known">
          <strong>Already in Federal One</strong>
          <ul>
            <li><span>Phones</span>{known.phones.length ? known.phones.join(', ') : 'None in file'}</li>
            <li><span>Addresses</span>{known.addresses.length ? known.addresses.join(' · ') : 'None in file'}</li>
            <li><span>Emails</span>{known.emails.length ? known.emails.join(', ') : 'None in file'}</li>
            <li><span>Spouse / associates</span>{known.associates.length ? known.associates.join(', ') : 'None in file'}</li>
          </ul>
        </div>
      )}
      {sources.length > 0 && (
        <div className="extra-links">
          {sources.map(source => (
            <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer">
              <strong>{source.name}</strong><small>{source.group}</small>
            </a>
          ))}
        </div>
      )}
      <label className="extra-paste">Paste what those sites showed
        <textarea value={extra} onChange={e => setExtra(e.target.value)} maxLength={2000} placeholder="Previous address, emails, spouse name, other phones…" />
      </label>
      <button type="button" onClick={() => void saveExtra()} disabled={busy || !extra.trim()}><Save size={15} /> Save extra info to file</button>
      {notice && <p className="extra-notice" role="status">{notice}</p>}
      {findings.length > 0 && (
        <div className="extra-saved">
          <strong>Saved extra info</strong>
          {findings.map(f => (
            <a key={f.id} href={f.source_url} target="_blank" rel="noopener noreferrer">
              <span>{f.finding_value}</span><small>{f.source_name}</small>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
