import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ExternalLink, Search, Loader2, AlertCircle, User, MapPin, Phone, Mail,
  Globe, ChevronDown, ChevronRight, Save, FileText
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

/* ── Client-side contact parser ────────────────────────────────────── */
function parseContactLine(raw: string): { name: string; phone: string; address: string; email: string } {
  let text = raw.trim();
  const emailMatch = text.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
  const email = emailMatch ? emailMatch[0] : '';
  if (email) text = text.replace(email, ' ');

  const phoneMatch = text.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
  const phone = phoneMatch ? phoneMatch[0] : '';
  if (phone) text = text.replace(phone, ' ');

  const stateZipPattern = /,?\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/;
  const addrPatterns = [
    /(\d{1,6}\s+[\w\s]+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Ln|Lane|Rd|Road|Way|Ct|Court|Pl|Place|Cir|Circle|Pass|Pkwy|Parkway|Trail|Trl|Loop|Run|Ter|Terrace)[.,]?\s+[\w\s]+,?\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)/i,
    /(\d{1,6}\s+\S[\w\s,]+[A-Z]{2}\s+\d{5}(?:-\d{4})?)/,
  ];
  let address = '';
  for (const pat of addrPatterns) {
    const m = text.match(pat);
    if (m) { address = m[1].replace(/\s*[·•|]+\s*/g, ' ').trim(); text = text.replace(m[1], ' '); break; }
  }
  if (!address) {
    const zm = text.match(stateZipPattern);
    if (zm) {
      const before = text.slice(0, zm.index!);
      const numM = before.match(/(\d{1,6}\s+[\w\s,]+)$/);
      if (numM) { address = (numM[1] + ' ' + zm[0]).replace(/\s*[·•|]+\s*/g, ' ').trim(); text = text.replace(numM[1], ' ').replace(zm[0], ' '); }
    }
  }

  const name = text.replace(/[·•|,]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return { name, phone, address, email };
}

/* ── Client-side link builder (mirrors server buildResearchSources) ─ */
const q = (v: string) => encodeURIComponent(v);
function buildLocalSources(name: string, phone: string, email: string, address: string): Source[] {
  const [first = '', ...rest] = name.split(/\s+/);
  const last = rest.pop() ?? '';
  const slug = first && last ? `${first}-${last}` : name.replace(/\s+/g, '-');
  const digits = phone.replace(/\D/g, '');
  const ttPhone = digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : '';
  const ttAddress = address ? address.replace(/[,#.]+/g, '').replace(/\s+/g, '-') : '';
  const exact = [`"${name}"`, phone ? `"${phone}"` : '', address ? `"${address}"` : '', email ? `"${email}"` : ''].filter(Boolean).join(' ');
  const addrParts = address ? address.replace(/[,]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ') : [];
  const cityStateZip = addrParts.length >= 3 ? addrParts.slice(-3).join('') : '';

  const s: Source[] = [];
  s.push({ id: 'tt_name', name: "That's Them (Name)", group: "That's Them", url: `https://thatsthem.com/name/${encodeURIComponent(slug)}` });
  if (ttPhone) s.push({ id: 'tt_phone', name: "That's Them (Phone)", group: "That's Them", url: `https://thatsthem.com/phone/${ttPhone}` });
  if (ttAddress) s.push({ id: 'tt_address', name: "That's Them (Address)", group: "That's Them", url: `https://thatsthem.com/address/${encodeURIComponent(ttAddress)}` });
  if (email) s.push({ id: 'tt_email', name: "That's Them (Email)", group: "That's Them", url: `https://thatsthem.com/email/${encodeURIComponent(email)}` });

  s.push({ id: 'google_exact', name: 'Google exact', group: 'Google Searches', url: `https://www.google.com/search?q=${q(exact)}` });
  s.push({ id: 'google_prev_addr', name: 'Google previous addresses', group: 'Google Searches', url: `https://www.google.com/search?q=${q(`"${name}" "previous address" OR formerly OR "used to live" OR "property records" ${address || ''}`)}` });
  s.push({ id: 'google_emails', name: 'Google emails', group: 'Google Searches', url: `https://www.google.com/search?q=${q(`"${name}" ${address || phone || ''} ${email || '"@gmail" OR "@yahoo" OR "@icloud" contact'}`)}` });
  s.push({ id: 'google_spouse', name: 'Google spouse / relatives', group: 'Google Searches', url: `https://www.google.com/search?q=${q(`"${name}" spouse OR wife OR husband OR married OR relative OR associate ${address || phone || ''}`)}` });

  s.push({ id: 'bing', name: 'Bing', group: 'Web', url: `https://www.bing.com/search?q=${q(exact)}` });
  s.push({ id: 'duckduckgo', name: 'DuckDuckGo', group: 'Web', url: `https://duckduckgo.com/?q=${q(exact)}` });
  s.push({ id: 'brave', name: 'Brave Search', group: 'Web', url: `https://search.brave.com/search?q=${q(exact)}` });

  const tpsUrl = cityStateZip ? `https://www.truepeoplesearch.com/results?name=${q(name)}&citystatezip=${q(cityStateZip)}` : `https://www.truepeoplesearch.com/results?name=${q(name)}`;
  s.push({ id: 'tps_name', name: 'TruePeopleSearch', group: 'People Search', url: tpsUrl });
  if (digits.length === 10) s.push({ id: 'tps_phone', name: 'TruePeopleSearch (Phone)', group: 'People Search', url: `https://www.truepeoplesearch.com/results?phoneno=${digits}` });
  s.push({ id: 'fps_name', name: 'FastPeopleSearch', group: 'People Search', url: `https://www.fastpeoplesearch.com/name/${q(slug)}` });
  if (digits.length === 10) s.push({ id: 'fps_phone', name: 'FastPeopleSearch (Phone)', group: 'People Search', url: `https://www.fastpeoplesearch.com/${digits}` });
  s.push({ id: 'ftn_name', name: 'FamilyTreeNow', group: 'People Search', url: `https://www.familytreenow.com/search/people?first=${q(first)}&last=${q(last)}` });
  s.push({ id: 'spf_name', name: 'SearchPeopleFree', group: 'People Search', url: `https://www.searchpeoplefree.com/find/${q(slug)}` });
  s.push({ id: 'cbc_name', name: 'CyberBackgroundChecks', group: 'People Search', url: `https://www.cyberbackgroundchecks.com/people/${q(slug)}` });

  s.push({ id: 'courtlistener', name: 'CourtListener', group: 'Records', url: `https://www.courtlistener.com/?q=${q(name)}&type=r` });
  s.push({ id: 'sec', name: 'SEC EDGAR', group: 'Records', url: `https://www.sec.gov/edgar/search/#/q=${q(name)}` });
  s.push({ id: 'licenses', name: 'Public licenses', group: 'Records', url: `https://www.google.com/search?q=${q(`"${name}" ${phone || address || ''} site:.gov license`)}` });
  s.push({ id: 'business', name: 'Business records', group: 'Records', url: `https://www.google.com/search?q=${q(`"${name}" ${phone || address || ''} business company officer`)}` });
  return s;
}

/* ── Component ──────────────────────────────────────────────────────── */
export function ExtraInfo({ sessionToken, onUnauthorized, prefill }: ExtraInfoProps) {
  const [rawInput, setRawInput] = useState('');
  const [parsed, setParsed] = useState<{ name: string; phone: string; address: string; email: string } | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [known, setKnown] = useState<KnownProfile | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [pasteText, setPasteText] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState('');

  const didPrefill = useRef(false);

  useEffect(() => {
    if (prefill?.name && !didPrefill.current) {
      didPrefill.current = true;
      const line = [prefill.name, prefill.phone, prefill.address, prefill.email].filter(Boolean).join(' · ');
      setRawInput(line);
      applyInput(line);
    }
  }, [prefill]);

  const applyInput = useCallback((text: string) => {
    const p = parseContactLine(text);
    if (!p.name) { setParsed(null); setSources([]); return; }
    setParsed(p);
    setSources(buildLocalSources(p.name, p.phone, p.email, p.address));
    setExpandedGroups(new Set(["That's Them", 'Google Searches', 'Web', 'People Search', 'Records']));
  }, []);

  const handleInputChange = (text: string) => {
    setRawInput(text);
    setError('');
    if (text.trim().length > 3) applyInput(text);
    else { setParsed(null); setSources([]); }
  };

  const prepareSearches = async () => {
    if (!parsed?.name) { setError('Paste a name first'); return; }
    setLoading(true); setError('');
    const [searchRes, findingsRes] = await Promise.all([
      authFetch<{ research: { sources: Source[]; known?: KnownProfile } }>(FEDERAL_ONE_V2_URL, {
        body: { action: 'start_source_search', session_token: sessionToken, client_name: parsed.name, client_phone: parsed.phone, client_email: parsed.email, client_address: parsed.address },
        onUnauthorized,
      }),
      authFetch<{ findings: Finding[] }>(FEDERAL_ONE_V2_URL, {
        body: { action: 'get_source_findings', session_token: sessionToken, client_name: parsed.name, client_phone: parsed.phone },
        onUnauthorized,
      }),
    ]);
    if (searchRes.ok && searchRes.data?.research?.known) setKnown(searchRes.data.research.known);
    if (findingsRes.ok && findingsRes.data?.findings) setFindings(findingsRes.data.findings);
    setLoading(false);
  };

  const openQuickTabs = () => {
    if (!parsed?.name) return;
    const ttName = sources.find(s => s.id === 'tt_name');
    const ttPhone = sources.find(s => s.id === 'tt_phone');
    const googleExact = sources.find(s => s.id === 'google_exact');
    const googlePrev = sources.find(s => s.id === 'google_prev_addr');
    [ttName, ttPhone, googleExact, googlePrev].forEach(s => { if (s) window.open(s.url, '_blank'); });
  };

  const handleSave = async () => {
    const text = pasteText.trim();
    if (!text || !parsed?.name) return;
    setSaving(true); setSaveNotice('');
    const result = await authFetch<{ finding: Finding }>(FEDERAL_ONE_V2_URL, {
      body: {
        action: 'save_source_finding', session_token: sessionToken,
        client_name: parsed.name, client_phone: parsed.phone,
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
        <p>Paste name, phone, address below. Links appear instantly -- no file search needed.</p>
      </div>

      <div className="extra-info-paste-box">
        <textarea
          className="extra-info-main-input"
          rows={2}
          value={rawInput}
          onChange={e => handleInputChange(e.target.value)}
          placeholder="Mary Deeb (727) 372-7375 · 10507 Alico Pass New Port Richey, FL 34655"
          autoFocus
        />
      </div>

      {parsed && parsed.name && (
        <div className="extra-info-parsed">
          <div className="extra-info-parsed-item"><User size={13} /> <strong>{parsed.name}</strong></div>
          {parsed.phone && <div className="extra-info-parsed-item"><Phone size={13} /> {parsed.phone}</div>}
          {parsed.address && <div className="extra-info-parsed-item"><MapPin size={13} /> {parsed.address}</div>}
          {parsed.email && <div className="extra-info-parsed-item"><Mail size={13} /> {parsed.email}</div>}
        </div>
      )}

      {error && <div className="extra-info-error"><AlertCircle size={14} /> {error}</div>}

      <div className="extra-info-actions">
        {sources.length > 0 && (
          <button className="extra-info-btn accent" onClick={openQuickTabs}>
            <ExternalLink size={15} /> Open That's Them + Google now
          </button>
        )}
        <button className="extra-info-btn primary" onClick={prepareSearches} disabled={loading || !parsed?.name}>
          {loading ? <><Loader2 size={15} className="spin" /> Checking files...</> : <><Search size={15} /> Prepare searches</>}
        </button>
      </div>

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
            placeholder={"Previous address: 456 Oak Ave, Tampa FL 33601\nSpouse: Jane Doe\nEmail: john.doe@yahoo.com"}
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
