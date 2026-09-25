import { adminSections } from './admin-sections';
import './admin-clarity.css';
export function AdminQuickLinks({onOpen}:{onOpen:(id:string)=>void}) {
 return <section className="admin-quick-links" aria-label="Admin shortcuts"><h2>What would you like to do?</h2><div>{adminSections.filter(s=>s.id!=='dashboard').map(s=><button type="button" key={s.id} onClick={()=>onOpen(s.id)}><strong>{s.label} →</strong><span>{s.hint}</span></button>)}</div></section>;
}
