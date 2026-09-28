export const OFFLINE_ACCESS_MESSAGE = 'System is offline permanently';

/** Shown only after the server rejects a specifically retired credential. */
export function OfflineAccessScreen() {
  return <main aria-labelledby="offline-access-heading" style={{
    minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24,
    background: '#090e14', color: '#f3f5f7', textAlign: 'center',
  }}>
    <div style={{ maxWidth: 620 }}>
      <svg role="img" aria-label="System offline" viewBox="0 0 240 180" width="240" height="180" style={{ maxWidth: '100%' }}>
        <rect x="24" y="20" width="192" height="122" rx="14" fill="#121c29" stroke="#64748b" strokeWidth="3" />
        <path d="M90 164h60M120 144v20" stroke="#64748b" strokeWidth="5" strokeLinecap="round" />
        <circle cx="120" cy="80" r="31" fill="#2c1820" stroke="#f87171" strokeWidth="4" />
        <path d="m98 58 44 44" stroke="#f87171" strokeWidth="5" strokeLinecap="round" />
      </svg>
      <h1 id="offline-access-heading" style={{ fontSize: 'clamp(28px, 5vw, 44px)', lineHeight: 1.2, margin: '20px 0', fontWeight: 700 }}>
        {OFFLINE_ACCESS_MESSAGE}
      </h1>
    </div>
  </main>;
}
