import { initials } from "@/app/shared";
import type { ApplicationModel } from "@/app/useApplicationModel";
import { fmtAttendanceDuration,presenceLabel } from '@/utils/attendance';
import {
LogOut,
Menu,
Phone,PhoneOff
} from 'lucide-react';

export function MainNavigation({ model }: { model: Pick<ApplicationModel, "setActiveNav" | "isOwner" | "etClock" | "setMobileMenuOpen" | "mobileMenuOpen" | "navItems" | "activeNav" | "myAttendance" | "attendanceError" | "agentAvailable" | "handleToggleAvailability" | "togglingAvail" | "session" | "handleLogout" > }) {
const { setActiveNav, isOwner, etClock, setMobileMenuOpen, mobileMenuOpen, navItems, activeNav, myAttendance, attendanceError, agentAvailable, handleToggleAvailability, togglingAvail, session, handleLogout } = model;
if (!session?.valid) return null;
return (<>
<header className="f1-command-bar">
        <button className="f1-command-identity" onClick={() => setActiveNav('dashboard')} aria-label="Open home">
          <span className="f1-command-orb">01</span>
          <span><strong>FEDERAL ONE</strong><small>{isOwner ? 'ADMIN' : 'AGENT'} · {etClock} CR</small></span>
        </button>
        <button className="mobile-menu" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-label="Open navigation">
          <Menu size={20} />
        </button>
        <nav className={`f1-command-nav ${mobileMenuOpen ? 'mobile-open' : ''}`}>
          {navItems.map(item => {
            const Icon = item.icon;
            return (
              <button key={item.id}
                className={`f1-command-link ${activeNav === item.id ? 'active' : ''}`}
                onClick={() => { setActiveNav(item.id); setMobileMenuOpen(false); }}>
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            );
          })}
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
