import { useEffect, useRef, useState } from 'react';
import { authFetch } from '@/utils/auth-fetch';

export function useContactSearch<T extends { id?: string; contact_key?: string }>(providerUrl: string, sessionToken: string, onUnauthorized: () => void) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<T[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searchTotal, setSearchTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const generationRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryRef = useRef('');
  const offsetRef = useRef(0);
  const sessionRef = useRef(sessionToken);
  const mountedRef = useRef(true);

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const reset = () => {
    clearTimer();
    generationRef.current += 1;
    queryRef.current = '';
    offsetRef.current = 0;
    setSearchQuery('');
    setSearchResults([]);
    setSearchTotal(0);
    setHasMore(false);
    setSearching(false);
    setSearchError(false);
  };

  useEffect(() => {
    mountedRef.current = true;
    if (sessionRef.current !== sessionToken) {
      sessionRef.current = sessionToken;
      reset();
    }
    return () => {
      mountedRef.current = false;
      clearTimer();
      generationRef.current += 1;
    };
  }, [sessionToken]);

  const doSearch = async (query: string, offset: number, generation: number) => {
    const requestSession = sessionToken;
    const result = await authFetch(providerUrl, {
      body: { action: 'search_contacts', session_token: requestSession, query: query.trim(), limit: 25, offset },
      onUnauthorized: () => {
        if (mountedRef.current && generation === generationRef.current && requestSession === sessionRef.current) onUnauthorized();
      },
    });
    if (!mountedRef.current || generation !== generationRef.current || requestSession !== sessionRef.current) return;
    if (result.ok && result.data) {
      const data = result.data as Record<string, unknown>;
      const rows = (data.results || data.contacts || []) as T[];
      const total = Number(data.count ?? data.total ?? rows.length);
      setSearchResults(previous => {
        const combined = offset === 0 ? rows : [...previous, ...rows];
        const seen = new Set<string>();
        return combined.filter((row, index) => {
          const key = row.contact_key || row.id || `row-${index}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      });
      offsetRef.current = offset + rows.length;
      setSearchTotal(total);
      setHasMore(offset + rows.length < total);
      setSearchError(false);
    } else if (!result.loggedOut) {
      setSearchError(true);
    }
    setSearching(false);
  };

  const onSearchChange = (input: React.ChangeEvent<HTMLInputElement> | string) => {
    const query = typeof input === 'string' ? input : input.target.value;
    clearTimer();
    generationRef.current += 1;
    const generation = generationRef.current;
    queryRef.current = query;
    offsetRef.current = 0;
    setSearchQuery(query);
    setSearchResults([]);
    setSearchTotal(0);
    setHasMore(false);
    setSearchError(false);
    if (!query.trim()) {
      setSearching(false);
      return;
    }
    setSearching(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void doSearch(query, 0, generation);
    }, 300);
  };

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || !queryRef.current.trim()) return;
    clearTimer();
    generationRef.current += 1;
    const generation = generationRef.current;
    setSearching(true);
    void doSearch(queryRef.current, 0, generation);
  };

  const loadMore = () => {
    if (!queryRef.current.trim() || searching) return;
    const generation = generationRef.current;
    setSearching(true);
    void doSearch(queryRef.current, offsetRef.current, generation);
  };

  return { searchQuery, searchResults, searching, searchError, searchTotal, hasMore, onSearchChange, onSearchKeyDown, loadMore };
}
