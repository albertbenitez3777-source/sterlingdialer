import { useState, type ReactNode } from 'react';
import { prefillPhone } from './phone-prefill';
export function PhoneNumber({ phone, children, className = '' }: { phone?: string | null; children?: ReactNode; className?: string }) {
 const [message, setMessage] = useState('');
 if (!phone) return <span>—</span>;
 return <span className="f1-number-wrap"><button type="button" className={`phone-link ${className}`} title="Put this number on the phone; press Dial to call" onClick={event => {
  event.stopPropagation();
  const result = prefillPhone(phone);
  setMessage(result === 'ready' ? 'Number ready — press Dial on the phone.' : result === 'busy' ? 'Finish your current call before choosing another number.' : result === 'invalid' ? 'This number is not valid for dialing.' : 'Open your agent workspace on a desktop to use the phone.');
 }}>{children || phone}</button>{message && <small role="status" onClick={event => event.stopPropagation()} style={{display:'block',fontSize:11,color:'#bcd5e5'}}>{message}</small>}</span>;
}
