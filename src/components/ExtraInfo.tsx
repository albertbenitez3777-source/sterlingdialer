import { useState, useEffect, useCallback } from 'react';
import { ExternalLink, Search, Loader2, AlertCircle, User, MapPin, Phone, Mail, Globe, ChevronDown, ChevronRight } from 'lucide-react';

const FEDERAL_ONE_V2_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/federal-one-v2`;

interface Source {
  id: string;
  name: string;
  group: string;
  url: string;
}

interface ContactResult {
  name: string;
  phone: string;
  email: string;
  address: string;
  sources: Source[];
  known_emails: string[];
  known_phones: string[];
  known_addresses: string[];
}

interface ExtraInfoProps {
  sessionToken: string;
  onUnauthorized: () => void;
}

export function ExtraInfo({ sessionToken, onUnauthorized }: ExtraInfoProps) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ContactResult | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const search = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch(`${FEDERAL_ONE_V2_URL}/research`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ query: trimmed }),
      });
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setResult(data);
      setExpandedGroups(new Set((data.sources as Source[]).map(s => s.group)));
    } catch (e: any) {
      setError(e.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [query, sessionToken, onUnauthorized]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Enter') search(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [search]);

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group); else next.add(group);
      return next;
    });
  };

  const groupOrder = ['Web', 'Identity', 'Email', 'History', 'Relationships', 'People Search', 'Records'];
  const grouped = result?.sources.reduce<Record<string, Source[]>>((acc, s) => {
    (acc[s.group] ??= []).push(s);
    return acc;
  }, {}) ?? {};

  return (
    <section className="extra-info-page">
      <div className="extra-info-header">
        <h2>Research a Contact</h2>
        <p>Enter a name, phone number, or address to generate research links across public directories.</p>
      </div>

      <div className="extra-info-search">
        <div className="extra-info-input-wrap">
          <Search size={16} className="extra-info-search-icon" />
          <input
            type="text"
            placeholder="Name, phone, email, or address..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="extra-info-input"
            autoFocus
          />
        </div>
        <button className="extra-info-btn" onClick={search} disabled={loading || !query.trim()}>
          {loading ? <Loader2 size={16} className="spin" /> : 'Search'}
        </button>
      </div>

      {error && (
        <div className="extra-info-error">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {result && (
        <div className="extra-info-results">
          <div className="extra-info-identity">
            <div className="extra-info-identity-name">
              <User size={16} /> <strong>{result.name}</strong>
            </div>
            <div className="extra-info-identity-details">
              {result.phone && <span><Phone size={13} /> {result.phone}</span>}
              {result.email && <span><Mail size={13} /> {result.email}</span>}
              {result.address && <span><MapPin size={13} /> {result.address}</span>}
            </div>
            {(result.known_emails.length > 0 || result.known_phones.length > 0 || result.known_addresses.length > 0) && (
              <div className="extra-info-known">
                {result.known_phones.length > 0 && <div className="extra-info-known-list"><Phone size={12} /> {result.known_phones.join(', ')}</div>}
                {result.known_emails.length > 0 && <div className="extra-info-known-list"><Mail size={12} /> {result.known_emails.join(', ')}</div>}
                {result.known_addresses.length > 0 && <div className="extra-info-known-list"><MapPin size={12} /> {result.known_addresses.join(', ')}</div>}
              </div>
            )}
          </div>

          <div className="extra-info-groups">
            {groupOrder.filter(g => grouped[g]).map(group => (
              <div key={group} className="extra-info-group">
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
        </div>
      )}
    </section>
  );
}
