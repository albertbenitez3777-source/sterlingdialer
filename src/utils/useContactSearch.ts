import { useEffect, useRef, useState } from 'react';
import { authFetch } from '@/utils/auth-fetch';

type ContactIdentity = { id: string; source?: string; contact_key?: string };
const identity = (contact: ContactIdentity) => contact.contact_key || `${contact.source || ''}:${contact.id}`;

// Keep this hook in App so changing tabs retains the query, results and page.
export function useContactSearch<T extends ContactIdentity>(providerUrl: string, sessionToken: string, onUnauthorized: () => void) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<T[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searchTotal, setSearchTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const requestTokenRef = useRef(0);
  const currentQueryRef = useRef('');
  const nextOffsetRef = useRef(0);
  const searchInFlightRef = useRef(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = () => {
    requestTokenRef.current++;
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchInFlightRef.current = false;
    nextOffsetRef.current = 0;
    setSearchResults([]);
    setSearchTotal(0);
    setHasMore(false);
    setSearchError(false);
    setSearching(false);
  };

  useEffect(() => {
    reset();
    currentQueryRef.current = '';
    setSearchQuery('');
    return () => {
      requestTokenRef.current++;
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
    // A session change must discard the previous user's contact data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToken]);

  const doSearch = async (query: string, offset = 0) => {
    const token = ++requestTokenRef.current;
    if (!query.trim()) { reset(); return; }
    currentQueryRef.current = query;
    if (offset === 0) { setSearchResults([]); setHasMore(false); }
    setSearchError(false);
    setSearching(true);
    searchInFlightRef.current = true;
    try {
      const result = await authFetch(providerUrl, {
        body: { action: 'search_contacts', session_token: sessionToken, search_text: query, offset },
        onUnauthorized: () => { if (token === requestTokenRef.current) onUnauthorized(); },
      });
      if (token !== requestTokenRef.current) return;
      if (!result.ok || !result.data) { setSearchError(true); return; }
      const data = result.data as Record<string, unknown>;
      const page = Array.isArray(data.results) ? data.results as T[] : [];
      const reportedTotal = Number(data.count);
      const total = Number.isFinite(reportedTotal) ? Math.max(0, reportedTotal) : offset + page.length;
      setSearchResults(previous => {
        if (offset === 0) return page;
        const seen = new Set(previous.map(identity));
        return [...previous, ...page.filter(contact => {
          const key = identity(contact);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })];
      });
      nextOffsetRef.current = offset + page.length;
      setSearchTotal(total);
      setHasMore(page.length > 0 && nextOffsetRef.current < total);
    } catch {
      if (token === requestTokenRef.current) setSearchError(true);
    } finally {
      if (token === requestTokenRef.current) {
        setSearching(false);
        searchInFlightRef.current = false;
      }
    }
  };

  const onSearchChange = (value: string) => {
    reset();
    currentQueryRef.current = value;
    setSearchQuery(value);
    setSearching(Boolean(value.trim()));
    if (value.trim()) searchTimerRef.current = setTimeout(() => void doSearch(value), 350);
  };
  const onSearchKeyDown = (event: { key: string }) => {
    if (event.key !== 'Enter') return;
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    void doSearch(currentQueryRef.current);
  };
  const loadMore = () => {
    if (!searchInFlightRef.current && hasMore) void doSearch(currentQueryRef.current, nextOffsetRef.current);
  };

  return { searchQuery, searchResults, searching, searchError, searchTotal, hasMore, onSearchChange, onSearchKeyDown, loadMore };
}
