import { useState } from 'react';
import { Search, Save, ExternalLink, RefreshCw } from 'lucide-react';
import { authFetch } from '@/utils/auth-fetch';
import './ExtraInfo.css';

type Source = { id: string; name: string; group: string; url: string };
type Known = { emails: string[]; phones: string[]; addresses: string[]; associates: string[]; records_checked: number };
type Finding = { id: string; source_name: string; source_url: string; finding_value: string; finding_type: string; match_status?: string };

const API = () => `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/federal-one-v2`;

export function ExtraInfo({
  sessionToken, onUnauthorized, initialName = '', initialPhone = '', initialAddress = '', initialEmail = '',
}: {
  sessionToken: string;
  onUnauthorized: () => void;
  initialName?: string;
  initialPhone?: string;
  initialAddress?: string;
  initialEmail?: string;
}) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [address, setAddress] = useState(initialAddress);
  const [email, setEmail] = useState(initialEmail);
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [sources, setSources] = useState<Source[]>([]);
  const [known, setKnown] = useState<Known | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);

  const run = async () => {
    if (!name.trim()) { setNotice('Name is required.'); return; }
    setBusy(true); setNotice('');
    const result = await authFetch<{ research: { sources: Source[]; known?: Known } }>(API(), {
      onUnauthorized,
      body: { action: 'start_source_search', session_token: sessionToken, client_name: name.trim(), client_phone: phone.trim(), client_email: email.trim(), client_address: address.trim() },
    });
    const findingsResult = await authFetch<{ findings: Finding[] }>(API(), {
      onUnauthorized,
      body: { action: 'get_source_findings', session_token: sessionToken, client_name: name.trim(), client_phone: phone.trim() },
    });
    if (result.ok && result.data?.research?.sources?.length) {
      setSources(result.data.research.sources);
      setKnown(result.data.research.known || null);
      setNotice(`${result.data.research.sources.length} searches ready. Open That's Them and Google yourself — Federal One does not scrape those sites.`);
    } else setNotice(result.error || 'Search could not be prepared.');
    if (findingsResult.ok) setFindings(findingsResult.data?.findings || []);
    setBusy(false);
  };

  const saveExtra = async () => {
    if (!name.trim() || !extra.trim()) { setNotice('Name and extra info are required to save.'); return; }
    setBusy(true);
    const result = await authFetch<{ finding: Finding }>(API(), {
      onUnauthorized,
      body: {
        action: 'save_source_finding', session_token: sessionToken,
        client_name: name.trim(), client_phone: phone.trim(),
        source_name: 'Extra Info', source_url: sources[0]?.url || 'https://thatsthem.com/',
        finding_type: 'other', finding_value: extra.trim(),
      },
    });
    if (result.ok) {
      setExtra('');
      setNotice('Extra info saved to this client file.');
      const findingsResult = await authFetch<{ findings: Finding[] }>(API(), {
        onUnauthorized,
        body: { action: 'get_source_findings', session_token: sessionToken, client_name: name.trim(), client_phone: phone.trim() },
      });
      if (findingsResult.ok) setFindings(findingsResult.data?.findings || []);
    } else setNotice(result.error || 'Could not save extra info.');
    setBusy(false);
  };

  const openPrimary = () => {
    const primary = sources.filter(s => s.id.startsWith('thatsthem') || s.id === 'google' || s.id === 'google_prev' || s.id === 'google_email' || s.id === 'google_spouse').slice(0, 4);
    primary.forEach(s => window.open(s.url, '_blank', 'noopener,noreferrer'));
  };

  return (
    <section className="extra-info" aria-label="Extra client information">
      <header>
        <small>EXTRA INFO</small>
        <h2>Build the rest of the file</h2>
        <p>Paste the name, phone, and address you already have. Federal One prepares That's Them, Google, and people-search links. You open the pages, then paste emails, previous addresses, or spouse names back here.</p>
      </header>
      <form onSubmit={e => { e.preventDefault(); void run(); }}>
        <label>Name<input value={name} onChange={e => setName(e.target.value)} required autoComplete="name" placeholder="First Last" /></label>
        <label>Telephone<input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="(555) 555-5555" /></label>
        <label>Address<input value={address} onChange={e => setAddress(e.target.value)} autoComplete="street-address" placeholder="Street, City, ST ZIP" /></label>
        <label>Email if known<input value={email} onChange={e => setEmail(e.target.value)} type="email" autoComplete="email" placeholder="optional" /></label>
        <button type="submit" disabled={busy}>{busy ? <RefreshCw size={15} className="spin" /> : <Search size={15} />} Prepare searches</button>
      </form>
      {known && (
        <div className="extra-known">
          <strong>Already on file</strong>
          <ul>
            <li><span>Phones</span>{known.phones.length ? known.phones.join(', ') : 'None yet'}</li>
            <li><span>Addresses</span>{known.addresses.length ? known.addresses.join(' · ') : 'None yet'}</li>
            <li><span>Emails</span>{known.emails.length ? known.emails.join(', ') : 'None yet'}</li>
            <li><span>Spouse / associates</span>{known.associates.length ? known.associates.join(', ') : 'None yet'}</li>
          </ul>
        </div>
      )}
      {sources.length > 0 && (
        <>
          <button type="button" className="extra-open" onClick={openPrimary}><ExternalLink size={15} /> Open That's Them + Google</button>
          <div className="extra-links">
            {sources.map(source => (
              <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer">
                <strong>{source.name}</strong><small>{source.group}</small>
              </a>
            ))}
          </div>
        </>
      )}
      <label className="extra-paste">Paste what you found
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
