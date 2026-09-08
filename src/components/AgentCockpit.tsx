import { useState, useMemo } from 'react';
import { Shield, Flame, Users, PhoneForwarded, PhoneCall, PhoneIncoming, XCircle, Search, Send, Phone, ChevronRight, Clock, Activity } from 'lucide-react';

type QueueRecord = {
  id: string; consumer_name: string; consumer_phone: string;
  consumer_address?: string; duration_seconds: number; ai_summary: string;
  transfer_status?: string; queue: string; created_at: string;
  agent_disposition?: string; callback_requested?: boolean;
};

export interface AgentTodayStats {
  human_drops: number;
  fire_transfers: number;
  voice_messages: number;
  failed_transfers: number;
  callbacks_due: number;
  completed_callbacks: number;
  new_voicemails: number;
  live_humans?: number;
  active_calls_now?: number;
  today_total?: number;
}

export interface AgentCockpitProps {
  agentName: string;
  available: boolean;
  togglingAvail: boolean;
  onToggleAvail: () => void;
  fireTransfers: QueueRecord[];
  humanDrops: QueueRecord[];
  todayStats: AgentTodayStats | null;
  onNavTo: (tab: string) => void;
  activeNav: string;
}

interface PipelineStat {
  label: string;
  value: number;
  icon: typeof Flame;
  color: string;
}

export function AgentCockpit(props: AgentCockpitProps) {
  const { agentName, available, togglingAvail, onToggleAvail, fireTransfers, humanDrops, todayStats, onNavTo, activeNav } = props;
  const [expanded, setExpanded] = useState(false);

  const pipeline = useMemo<PipelineStat[]>(() => {
    if (todayStats) {
      return [
        { label: 'Active Now', value: todayStats.active_calls_now ?? 0, icon: PhoneCall, color: 'rust' },
        { label: 'Live Humans Today', value: todayStats.live_humans ?? todayStats.human_drops, icon: Users, color: 'gold' },
        { label: 'Transfers Today', value: todayStats.fire_transfers, icon: PhoneForwarded, color: 'steel' },
        { label: 'Failed', value: todayStats.failed_transfers, icon: XCircle, color: 'error' },
        { label: 'Callbacks', value: todayStats.callbacks_due, icon: PhoneIncoming, color: 'steel' },
        { label: 'Today Total', value: todayStats.today_total ?? 0, icon: Activity, color: 'sage' },
      ];
    }
    const transfers = fireTransfers.length;
    const liveHumans = humanDrops.length;
    const allRecords = [...fireTransfers, ...humanDrops];
    const failed = allRecords.filter(r => r.transfer_status === 'failed' || r.transfer_status === 'transfer_failed_unverified').length;
    const callbacks = allRecords.filter(r => r.callback_requested).length;
    return [
      { label: 'Hot Transfers', value: transfers + liveHumans, icon: PhoneForwarded, color: 'rust' },
      { label: 'Live Humans', value: liveHumans, icon: Users, color: 'gold' },
      { label: 'Transfers', value: transfers, icon: PhoneForwarded, color: 'steel' },
      { label: 'Failed', value: failed, icon: XCircle, color: 'error' },
      { label: 'Callbacks', value: callbacks, icon: PhoneIncoming, color: 'steel' },
      { label: 'Ready', value: transfers + liveHumans, icon: Activity, color: 'sage' },
    ];
  }, [fireTransfers, humanDrops, todayStats]);

  const firstName = agentName.split(' ')[0] || 'Agent';
  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening';
  const totalReady = fireTransfers.length + humanDrops.length;

  return (
    <div className="agent-cockpit" role="region" aria-label="Agent cockpit">
      {/* Header */}
      <div className="cockpit-header">
        <div className="cockpit-greeting">
          <h2>{greeting}, {firstName}</h2>
          <p className="cockpit-subtitle">
            {todayStats ? 'Your pipeline today' : 'Your transfer pipeline at a glance'}
          </p>
        </div>
        <button
          className={`cockpit-avail-toggle ${available ? 'online' : 'offline'}`}
          onClick={onToggleAvail}
          disabled={togglingAvail}
          aria-label={available ? 'Go offline' : 'Go online'}
        >
          <span className={`cockpit-avail-dot ${available ? 'pulse' : ''}`} />
          <span>{togglingAvail ? 'Updating...' : available ? 'Online' : 'Offline'}</span>
        </button>
      </div>

      {/* Pipeline stats */}
      <div className="cockpit-pipeline">
        {pipeline.map(s => (
          <div key={s.label} className={`cockpit-stat cockpit-stat-${s.color}`}>
            <s.icon size={14} className="cockpit-stat-icon" />
            <span className="cockpit-stat-value">{s.value}</span>
            <span className="cockpit-stat-label">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div className="cockpit-actions">
        <button
          className={`cockpit-action ${activeNav === 'calls' ? 'active' : ''}`}
          onClick={() => onNavTo('calls')}
        >
          <Flame size={16} />
          <span>Call Now</span>
          {totalReady > 0 && <span className="cockpit-badge">{totalReady}</span>}
        </button>
        <button
          className={`cockpit-action ${activeNav === 'contacts' ? 'active' : ''}`}
          onClick={() => onNavTo('contacts')}
        >
          <Search size={16} />
          <span>Contacts</span>
        </button>
        <button
          className={`cockpit-action ${activeNav === 'secretary' ? 'active' : ''}`}
          onClick={() => onNavTo('secretary')}
        >
          <Send size={16} />
          <span>Secretary</span>
        </button>
        <button
          className={`cockpit-action ${activeNav === 'saved' ? 'active' : ''}`}
          onClick={() => onNavTo('saved')}
        >
          <Phone size={16} />
          <span>Saved</span>
        </button>
      </div>

      {/* Recent activity preview */}
      {totalReady > 0 && (
        <div className="cockpit-recent">
          <button
            className="cockpit-recent-toggle"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
          >
            <Clock size={12} />
            <span>Recent Transfers ({totalReady})</span>
            <ChevronRight size={14} className={`cockpit-chevron ${expanded ? 'open' : ''}`} />
          </button>
          {expanded && (
            <div className="cockpit-recent-list">
              {[...fireTransfers, ...humanDrops].slice(0, 5).map(r => (
                <div key={r.id} className="cockpit-recent-item">
                  <span className="cockpit-recent-name">{r.consumer_name || 'Unknown'}</span>
                  <span className={`cockpit-recent-status ${r.queue === 'fire_transfer' ? 'hot' : 'warm'}`}>
                    {r.queue === 'fire_transfer' ? 'HOT' : 'LIVE'}
                  </span>
                  <span className="cockpit-recent-time">
                    {new Date(r.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="cockpit-footer">
        <Shield size={10} />
        <span>Showing your authorized data only</span>
      </div>
    </div>
  );
}
