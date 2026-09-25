export function ReportedMetrics({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span>Not reported</span>;
  if (typeof value !== 'object') return <span>{typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}</span>;
  return <div style={{padding:'8px 12px'}}>{Object.entries(value as Record<string,unknown>).map(([key, item]) => {
    const label = key.replace(/talkroute/gi, 'Zadarma').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
    return item && typeof item === 'object' ? <details key={key}><summary>{label}</summary><ReportedMetrics value={item}/></details> : <div key={key} style={{display:'flex',justifyContent:'space-between',gap:20,padding:'7px 0',borderBottom:'1px solid #ffffff12'}}><span>{label}</span><ReportedMetrics value={item}/></div>;
  })}</div>;
}
