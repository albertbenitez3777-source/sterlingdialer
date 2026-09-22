import { useEffect, useState } from 'react';
import { authFetch } from '@/utils/auth-fetch';

// Keep the badge available even while the desktop calling connection is offline.
export function useVoicemailCount(sessionToken: string, providerUrl: string) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    let running = false;
    setCount(null);
    const refresh = async () => {
      if (running || document.visibilityState === 'hidden') return;
      running = true;
      try {
        const result = await authFetch<{messages: {heard_at?: string | null}[]}>(providerUrl, {
          body: {action: 'mailbox_list', session_token: sessionToken},
          onUnauthorized: () => {},
        });
        if (alive) setCount(result.ok && result.data ? result.data.messages.filter(m => !m.heard_at).length : null);
      } finally { running = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    const onChange = () => { void refresh(); };
    document.addEventListener('visibilitychange', onChange);
    window.addEventListener('f1-voicemail-heard', onChange);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onChange);
      window.removeEventListener('f1-voicemail-heard', onChange);
    };
  }, [sessionToken, providerUrl]);
  return count;
}
