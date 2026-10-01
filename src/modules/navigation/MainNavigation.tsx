import { adminSections, adminSection } from '@/modules/owner/admin-sections';
import { useRef } from 'react';
import './workspace-layout.css';
import { initials } from "@/app/shared";
import type { ApplicationModel } from "@/app/useApplicationModel";
import { fmtAttendanceDuration,presenceLabel } from '@/utils/attendance';
import {
LogOut,
Menu,
ChevronDown,
Phone,PhoneOff
} from 'lucide-react';

export function MainNavigation({ model }: { model: Pick<ApplicationModel, "setActiveNav" | "isOwner" | "etClock" | "setMobileMenuOpen" | "mobileMenuOpen" | "navItems" | "activeNav" | "myAttendance" | "attendanceError" | "agentAvailable" | "handleToggleAvailability" | "togglingAvail" | "session" | "handleLogout" > }) {
const { setActiveNav, isOwner, etClock, setMobileMenuOpen, mobileMenuOpen, navItems, activeNav, myAttendance, attendanceError, agentAvailable, handleToggleAvailability, togglingAvail, session, handleLogout } = model;
const moreTools = useRef<HTMLDetailsElement>(null);
if (!session?.valid) return null;
const ordered = isOwner ? [...navItems].sort((a,b)=>adminSections.findIndex(s=>s.id===a.id)-adminSections.findIndex(s=>s.id===b.id)) : navItems;
const primaryIds = new Set(['dashboard', 'calls', 'opportunities', 'inbox', 'contacts', 'monitoring']);
const primary = ordered.filter(item => primaryIds.has(item.id));
const secondary = ordered.filter(item => !primaryIds.has(item.id));
const openSection = (id: string) => {
  setActiveNav(id);
  setMobileMenuOpen(false);
  if (moreTools.current) moreTools.current.open = false;
};
const navigationButton = (item: typeof navItems[number]) => {
  const Icon = item.icon;
  return <button type="button" key={item.id} aria-current={activeNav === item.id ? 'page' : undefined} title={isOwner ? adminSection(item.id)?.hint : undefined}
    className={`f1-command-link ${activeNav === item.id ? 'active' : ''}`} onClick={() => openSection(item.id)}>
    <Icon size={16} /><span>{isOwner ? adminSection(item.id)?.label || item.label : item.label}</span>
  </button>;
};
return (<>
<header className="f1-command-bar">
        <button className="f1-command-identity" onClick={() => openSection('dashboard')} aria-label="Open home">
          <span className="f1-command-orb">01</span>
          <span><strong>FEDERAL ONE</strong><small>{isOwner ? 'ADMIN' : 'AGENT'} · {etClock} CR</small></span>
        </button>
        <button className="mobile-menu" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-label="Open navigation" aria-expanded={mobileMenuOpen} aria-controls="workspace-navigation">
          <Menu size={20} />
        </button>
        <nav id="workspace-navigation" aria-label="Workspace navigation" className={`f1-command-nav ${mobileMenuOpen ? 'mobile-open' : ''}`}>
          {primary.map(navigationButton)}
          {secondary.length > 0 && <details ref={moreTools} className="f1-more-tools" onKeyDown={event => { if (event.key === 'Escape' && moreTools.current) { moreTools.current.open = false; moreTools.current.querySelector('summary')?.focus(); } }}>
            <summary className={`f1-command-link ${secondary.some(item => item.id === activeNav) ? 'active' : ''}`}>More tools <ChevronDown size={14} /></summary>
            <div className="f1-more-tools-panel">{secondary.map(navigationButton)}</div>
          </details>}
        </nav>
        <div className="f1-command-user">
          {!isOwner && myAttendance && <span className={`f1-presence-dot ${attendanceError ? 'warn' : myAttendance.presence}`} title={attendanceError || `${presenceLabel(myAttendance.presence)} · Today ${fmtAttendanceDuration(myAttendance.todayTotalSeconds)}`} />}
          {!isOwner && <button className={`f1-ready-button ${agentAvailable ? 'available' : ''}`} onClick={handleToggleAvailability} disabled={togglingAvail}>
            {agentAvailable ? <><Phone size={14} /> At desk</> : <><PhoneOff size={14} /> Away</>}
          </button>}
          <span className={`avatar ${isOwner ? 'gold' : 'green'}`}>{initials(session.agent?.full_name || '')}</span>
          <button className="f1-exit-button" onClick={handleLogout} title={`Log out ${session.agent?.full_name || ''}`}><LogOut size={16} /></button>
        </div>
      </header>
</>);
}
