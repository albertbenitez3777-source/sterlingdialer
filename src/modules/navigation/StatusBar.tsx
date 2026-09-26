import { adminSection } from '@/modules/owner/admin-sections';
import type { ApplicationModel } from "@/app/useApplicationModel";
import {
FileText
} from 'lucide-react';

export function StatusBar({ model }: { model: Pick<ApplicationModel, "isOwner" | "navItems" | "activeNav" | "setExtraInfoPrefill" | "setActiveNav" | "adminStats" | "etClock" > }) {
const { isOwner, navItems, activeNav, setExtraInfoPrefill, setActiveNav, adminStats, etClock } = model;
const staleStatus = !adminStats?.summary.as_of || Date.now() - new Date(adminStats.summary.as_of).getTime() > 90000;
return (<>
<div className="topbar f1-status-strip">
          <div className="breadcrumbs"><strong>{isOwner ? adminSection(activeNav)?.label : navItems.find(n => n.id === activeNav)?.label}</strong></div>
          <div className="top-actions">
            <button className="f1-extra-info-quick" onClick={() => { setExtraInfoPrefill(null); setActiveNav('extra'); }}><FileText size={14} /> Extra Info</button>
            {adminStats && (
              <div className={`dialer-indicator ${adminStats.summary.campaign_state === 'running' ? (adminStats.summary.dialer_status === 'waiting_for_agents' ? 'waiting' : 'running') : 'stopped'}`}>
                <div className={`dialer-spinner ${adminStats.summary.campaign_state === 'running' ? (adminStats.summary.dialer_status === 'waiting_for_agents' ? 'waiting' : 'running') : 'stopped'}`}></div>
                <b>{staleStatus ? 'DIALER STATUS NEEDS REFRESH' : adminStats.summary.campaign_state === 'running' ? (adminStats.summary.dialer_status === 'waiting_for_agents' ? 'WAITING FOR AGENTS' : 'DIALER ACTIVE') : 'DIALER STOPPED'}</b>
              </div>
            )}
            <div className="market-indicator">
              <span>{etClock}</span> CR
            </div>
          </div>
        </div>
{isOwner && <p className="admin-section-help">{adminSection(activeNav)?.hint}</p>}
</>);
}
