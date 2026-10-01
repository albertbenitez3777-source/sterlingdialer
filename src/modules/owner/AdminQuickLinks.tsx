import { adminSections } from './admin-sections';
import './admin-clarity.css';
export function AdminQuickLinks({onOpen}:{onOpen:(id:string)=>void}) {
 const primaryIds = new Set(['monitoring', 'calls', 'opportunities', 'contacts']);
 const shortcut = (s: typeof adminSections[number]) => <button type="button" key={s.id} onClick={()=>onOpen(s.id)}><strong>{s.label} →</strong><span>{s.hint}</span></button>;
 return <section className="admin-quick-links" aria-label="Admin shortcuts">
  <h2>Daily work</h2>
  <div>{adminSections.filter(s=>primaryIds.has(s.id)).map(shortcut)}</div>
  <details className="admin-more-tools"><summary>More administration tools</summary><div>{adminSections.filter(s=>s.id!=='dashboard'&&!primaryIds.has(s.id)).map(shortcut)}</div></details>
 </section>;
}
