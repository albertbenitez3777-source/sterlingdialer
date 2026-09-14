import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ExternalLink, Search, Loader2, AlertCircle, User, MapPin, Phone, Mail,
  Globe, ChevronDown, ChevronRight, Save, ExternalLink as OpenIcon, FileText
} from 'lucide-react';
import { authFetch } from '@/utils/auth-fetch';

const FEDERAL_ONE_V2_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/federal-one-v2`;

interface Source { id: string; name: string; group: string; url: string; }
interface KnownProfile { emails: string[]; phones: string[]; addresses: string[]; associates: string[]; records_checked: number; }
interface Finding { id: string; source_name: string; finding_type: string; finding_value: string; created_at: string; }

interface ExtraInfoProps {
  sessionToken: string;
  onUnauthorized: () => void;
  prefill?: { name?: string; phone?: string; address?: string; email?: string } | null;
}

export function ExtraInfo({ sessionToken, onUnauthorized, prefill }: ExtraInfoProps) {
  const [name, setName] = useState(prefill?.name ?? '');
  const [phone, setPhone] = useState(prefill?.phone ?? '');
  const [address, setAddress] = useState(prefill?.address ?? '');
  const [email, setEmail] = useState(prefill?.email ?? '');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sources, setSources] = useState<Source[]>([]);
  const [known, setKnown] = useState<KnownProfile | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const [pasteText, setPasteText] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState('');

  const didAutoSearch = useRef(false);

  useEffect(() => {
    if (prefill?.name) { setName(prefill.name); setPhone(prefill.phone ?? ''); setAddress(prefill.address ?? ''); setEmail(prefill.email ?? ''); }
  }, [prefill]);

  useEffect(() => {
    if (prefill?.name && !didAutoSearch.current) {
      didAutoSearch.current = true;
      runSearch(prefill.name, prefill.phone ?? '', prefill.address ?? '', prefill.email ?? '');
    }
  }, [prefill]);

  const runSearch = useCallback(async (n: string, p: string, a: string, e: string) => {
    if (!n.trim()) { setError('Name is required'); return; }
    setLoading(true); setError(''); setSources([]); setKnown(null); setFindings([]);
    const [searchRes, findingsRes] = await Promise.all([
      authFetch<{ research: { sources: Source[]; known?: KnownProfile } }>(FEDERAL_ONE_V2_URL, {
        body: { action: 'start_source_search', session_token: sessionToken, client_name: n.trim(), client_phone: p.trim(), client_email: e.trim(), client_address: a.trim() },
        onUnauthorized,
      }),
      authFetch<{ findings: Finding[] }>(FEDERAL_ONE_V2_URL, {
        body: { action: 'get_source_findings', session_token: sessionToken, client_name: n.trim(), client_phone: p.trim() },
        onUnauthorized,
      }),
    ]);
    if (searchRes.ok && searchRes.data?.research) {
      const s = searchRes.data.research.sources || [];
      setSources(s);
      if (searchRes.data.research.known) setKnown(searchRes.data.research.known);
      setExpandedGroups(new Set(s.map(src => src.group)));
    } else {
      setError(searchRes.error || 'Search could not be prepared');
    }
    if (findingsRes.ok && findingsRes.data?.findings) setFindings(findingsRes.data.findings);
    setLoading(false);
  }, [sessionToken, onUnauthorized]);

  const handleSearch = () => runSearch(name, phone, address, email);

  const openQuickTabs = () => {
    const ttName = sources.find(s => s.id === 'tt_name');
    const ttPhone = sources.find(s => s.id === 'tt_phone');
    const googleExact = sources.find(s => s.id === 'google_exact');
    const googlePrev = sources.find(s => s.id === 'google_prev_addr');
    [ttName, ttPhone, googleExact, googlePrev].forEach(s => { if (s) window.open(s.url, '_blank'); });
  };

  const handleSave = async () => {
    const text = pasteText.trim();
    if (!text) return;
    if (!name.trim()) { setSaveNotice('Name is required to save.'); return; }
    setSaving(true); setSaveNotice('');
    const result = await authFetch<{ finding: Finding }>(FEDERAL_ONE_V2_URL, {
      body: {
        action: 'save_source_finding', session_token: sessionToken,
        client_name: name.trim(), client_phone: phone.trim(),
        source_name: 'Extra Info', source_url: 'https://thatsthem.com/',
        finding_type: 'other', finding_value: text,
      },
      onUnauthorized,
    });
    if (result.ok && result.data?.finding) {
      setFindings(prev => [result.data!.finding, ...prev]);
      setPasteText('');
      setSaveNotice('Saved.');
    } else {
      setSaveNotice(result.error || 'Could not save');
    }
    setSaving(false);
  };

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(group) ? next.delete(group) : next.add(group);
      return next;
    });
  };

  const groupOrder = ["That's Them", 'Google Searches', 'Web', 'People Search', 'Records'];
  const grouped = sources.reduce<Record<string, Source[]>>((acc, s) => { (acc[s.group] ??= []).push(s); return acc; }, {});

  return (
    <section className="extra-info-page">
      <div className="extra-info-header">
        <h2>Extra Info</h2>
        <p>Enter a contact's details to search public directories. Nothing is scraped -- links open in your browser.</p>
      </div>

      <div className="extra-info-fields">
        <div className="extra-info-field">
          <label>Name <span className="required">*</span></label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="First Last" className="extra-info-input" />
        </div>
        <div className="extra-info-field">
          <label>Telephone</label>
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="555-555-5555" className="extra-info-input" />
        </div>
        <div className="extra-info-field">
          <label>Address</label>
          <input value={address} onChange={e => setAddress(e.target.value)} placeholder="123 Main St, City, ST 12345" className="extra-info-input" />
        </div>
        <div className="extra-info-field">
          <label>Email</label>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="contact@example.com" className="extra-info-input" />
        </div>
      </div>

      <div className="extra-info-actions">
        <button className="extra-info-btn primary" onClick={handleSearch} disabled={loading || !name.trim()}>
          {loading ? <><Loader2 size={15} className="spin" /> Preparing...</> : <><Search size={15} /> Prepare Searches</>}
        </button>
        {sources.length > 0 && (
          <button className="extra-info-btn accent" onClick={openQuickTabs}>
            <OpenIcon size={15} /> Open That's Them + Google
          </button>
        )}
      </div>

      {error && <div className="extra-info-error"><AlertCircle size={14} /> {error}</div>}

      {known && (
        <div className="extra-info-known-section">
          <div className="extra-info-section-label">ALREADY ON FILE</div>
          <div className="extra-info-known-grid">
            <div><Phone size={12} /> <span>Phones:</span> <strong>{known.phones.length ? known.phones.join(', ') : 'None found'}</strong></div>
            <div><MapPin size={12} /> <span>Addresses:</span> <strong>{known.addresses.length ? known.addresses.join(' | ') : 'None found'}</strong></div>
            <div><Mail size={12} /> <span>Emails:</span> <strong>{known.emails.length ? known.emails.join(', ') : 'None found'}</strong></div>
            <div><User size={12} /> <span>Spouse / Associates:</span> <strong>{known.associates.length ? known.associates.join(', ') : 'None found'}</strong></div>
          </div>
          <div className="extra-info-records-count">{known.records_checked} record{known.records_checked !== 1 ? 's' : ''} checked</div>
        </div>
      )}

      {sources.length > 0 && (
        <div className="extra-info-groups">
          {groupOrder.filter(g => grouped[g]).map(group => (
            <div key={group} className={`extra-info-group ${group === "That's Them" ? 'highlight' : ''}`}>
              <button className="extra-info-group-header" onClick={() => toggleGroup(group)}>
                {expandedGroups.has(group) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span>{group}</span>
                <span className="extra-info-group-count">{grouped[group].length}</span>
              </button>
              {expandedGroups.has(group) && (
                <div className="extra-info-links">
                  {grouped[group].map(src => (
                    <a key={src.id} href={src.url} target="_blank" rel="noopener noreferrer" className="extra-info-link">
                      <Globe size={13} />
                      <span>{src.name}</span>
                      <ExternalLink size={11} className="extra-info-external" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {sources.length > 0 && (
        <div className="extra-info-paste-section">
          <div className="extra-info-section-label">PASTE FINDINGS</div>
          <p className="extra-info-paste-hint">Paste previous addresses, emails, spouse names, extra phone numbers, or anything useful.</p>
          <textarea
            className="extra-info-textarea"
            rows={4}
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            placeholder="Previous address: 456 Oak Ave, Tampa FL 33601&#10;Spouse: Jane Doe&#10;Email: john.doe@yahoo.com"
          />
          <div className="extra-info-paste-actions">
            <button className="extra-info-btn primary" onClick={handleSave} disabled={saving || !pasteText.trim()}>
              {saving ? <><Loader2 size={14} className="spin" /> Saving...</> : <><Save size={14} /> Save Extra Info</>}
            </button>
            {saveNotice && <span className={`extra-info-save-notice ${saveNotice === 'Saved.' ? 'success' : 'fail'}`}>{saveNotice}</span>}
          </div>
        </div>
      )}

      {findings.length > 0 && (
        <div className="extra-info-findings">
          <div className="extra-info-section-label">SAVED FINDINGS ({findings.length})</div>
          {findings.map(f => (
            <div key={f.id} className="extra-info-finding">
              <FileText size={12} />
              <span className="finding-value">{f.finding_value}</span>
              <span className="finding-meta">{f.source_name} · {new Date(f.created_at).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
