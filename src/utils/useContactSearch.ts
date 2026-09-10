import { useState, useCallback, useRef } from 'react';
import { authFetch } from '@/utils/auth-fetch';

export function useContactSearch<T>(providerUrl: string, sessionToken: string, onUnauthorized: () => void) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<T[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchTotal, setSearchTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const offsetRef = useRef(0);
  const queryRef = useRef('');

  const doSearch = useCallback(async (query: string, offset = 0) => {
    if (!query.trim()) {
      setSearchResults([]);
      setSearchTotal(0);
      setHasMore(false);
      return;
    }
    setSearching(true);
    setSearchError(null);
    queryRef.current = query;
    offsetRef.current = offset;

    const result = await authFetch(providerUrl, {
      body: { action: 'search_contacts', session_token: sessionToken, query: query.trim(), limit: 25, offset },
      onUnauthorized,
    });

    if (result.ok && result.data) {
      const d = result.data as Record<string, unknown>;
      const rows = (d.results || d.contacts || []) as T[];
      const total = (d.total ?? rows.length) as number;
      if (offset === 0) {
        setSearchResults(rows);
      } else {
        setSearchResults(prev => [...prev, ...rows]);
      }
      setSearchTotal(total);
      setHasMore(offset + rows.length < total);
    } else if (!result.loggedOut) {
      setSearchError(result.error || 'Search failed');
    }
    setSearching(false);
  }, [providerUrl, sessionToken, onUnauthorized]);

  const onSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  }, []);

  const onSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') doSearch(searchQuery);
  }, [doSearch, searchQuery]);

  const loadMore = useCallback(() => {
    doSearch(queryRef.current, offsetRef.current + 25);
  }, [doSearch]);

  return {
    searchQuery, searchResults, searching, searchError, searchTotal, hasMore,
    onSearchChange, onSearchKeyDown, loadMore,
  };
}
