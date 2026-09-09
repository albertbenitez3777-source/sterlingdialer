import { useEffect, useState } from 'react';
import { Copy, Clock, ArrowDownRight, X, AlertTriangle, ChevronDown, ChevronUp, MapPin, DollarSign, Home, FileText } from 'lucide-react';
import { RecordingPlayer } from './RecordingPlayer';

export type ActiveTransfer = {
  id: string;
  call_id: string;
  phone_normalized: string;
  consumer_name: string;
  consumer_address: string;
  consumer_home_value: string;
  consumer_income_range: string;
  consumer_property_info: string;
  consumer_custom_fields: Record<string, unknown> | null;
  transfer_status: string;
  agent_name: string;
  created_at: string;
  resolved_at: string | null;
};

export interface IncomingTransferPanelProps {
  transfers: ActiveTransfer[];
  loading: boolean;
  error: string | null;
  onDismiss: (id: string) => void;
  sessionToken: string;
  onUnauthorized: () => void;
}

function fmtPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const last10 = digits.slice(-10);
  if (last10.length === 10) return `(${last10.slice(0, 3)}) ${last10.slice(3, 6)}-${last10.slice(6)}`;
  return phone;
}

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
}

function CustomFields({ fields }: { fields: Record<string, unknown> | null }) {
  if (!fields) return null;
  const entries = Object.entries(fields).filter(([, v]) => v != null && v !== '' && v !== '{}');
  if (entries.length === 0) return null;
  return (
    <div className="itp-custom-fields">
      {entries.map(([key, val]) => (
        <div key={key} className="itp-detail-row">
          <FileText size={13} className="itp-detail-icon" />
          <span><strong>{key.replace(/_/g, ' ')}:</strong> {String(val)}</span>
        </div>
      ))}
    </div>
  );
}

function TransferCard({ transfer, onDismiss, sessionToken, onUnauthorized }: { transfer: ActiveTransfer; onDismiss: (id: string) => void; sessionToken: string; onUnauthorized: () => void }) {
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(timeAgo(transfer.created_at));

  useEffect(() => {
    const t = setInterval(() => setElapsed(timeAgo(transfer.created_at)), 1000);
    return () => clearInterval(t);
  }, [transfer.created_at]);

  const hasName = !!transfer.consumer_name?.trim();
  const hasAddress = !!transfer.consumer_address?.trim();
  const hasHomeValue = !!transfer.consumer_home_value?.trim();
  const hasIncome = !!transfer.consumer_income_range?.trim();
  const hasProperty = !!transfer.consumer_property_info?.trim();
  const hasCustom = transfer.consumer_custom_fields && Object.keys(transfer.consumer_custom_fields).length > 0;
  const phoneOnly = !hasName && !hasAddress && !hasHomeValue && !hasIncome && !hasProperty && !hasCustom;

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const statusClass = transfer.transfer_status === 'pending' ? 'itp-status-pending'
    : transfer.transfer_status === 'connected' ? 'itp-status-connected' : 'itp-status-other';

  return (
    <div className={`itp-card ${phoneOnly ? 'itp-card-phone-only' : ''}`}>
      <div className="itp-card-header">
        <div className="itp-card-header-left">
          <div className={`itp-pulse ${statusClass}`} />
          <div className="itp-card-title">
            <strong>{hasName ? transfer.consumer_name : 'Unknown Contact'}</strong>
            <span className="itp-card-phone">{fmtPhone(transfer.phone_normalized)}</span>
          </div>
        </div>
        <div className="itp-card-header-right">
          <span className="itp-elapsed"><Clock size={12} /> {elapsed}</span>
          <button className="itp-btn-icon" onClick={() => setExpanded(!expanded)} aria-label={expanded ? 'Collapse' : 'Expand'}>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button className="itp-btn-icon itp-dismiss" onClick={() => onDismiss(transfer.id)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      </div>

      {phoneOnly && (
        <div className="itp-phone-only-label">
          <AlertTriangle size={12} /> Phone number only — no contact data available
        </div>
      )}

      <div className="itp-actions">
        <button className="itp-action-btn" onClick={() => handleCopy(transfer.phone_normalized, 'phone')}>
          <Copy size={12} /> {copied === 'phone' ? 'Copied!' : 'Copy Number'}
        </button>
        {hasName && (
          <button className="itp-action-btn" onClick={() => {
            const parts = [transfer.consumer_name, fmtPhone(transfer.phone_normalized), transfer.consumer_address, transfer.consumer_home_value, transfer.consumer_income_range].filter(Boolean);
            handleCopy(parts.join('\n'), 'all');
          }}>
            <FileText size={12} /> {copied === 'all' ? 'Copied!' : 'Copy All'}
          </button>
        )}
      </div>

      {expanded && !phoneOnly && (
        <div className="itp-details">
          {hasAddress && <div className="itp-detail-row"><MapPin size={13} className="itp-detail-icon" /><span>{transfer.consumer_address}</span></div>}
          {hasHomeValue && <div className="itp-detail-row"><Home size={13} className="itp-detail-icon" /><span>Home Value: {transfer.consumer_home_value}</span></div>}
          {hasIncome && <div className="itp-detail-row"><DollarSign size={13} className="itp-detail-icon" /><span>Income: {transfer.consumer_income_range}</span></div>}
          {hasProperty && <div className="itp-detail-row"><FileText size={13} className="itp-detail-icon" /><span>{transfer.consumer_property_info}</span></div>}
          <CustomFields fields={transfer.consumer_custom_fields} />
        </div>
      )}
      {expanded && transfer.call_id && (
        <div className="itp-details">
          <p className="itp-detail-row">Full call recording includes the AI conversation before transfer. Available after the call finishes and the recording is processed.</p>
          <RecordingPlayer url={null} callId={transfer.call_id} sessionToken={sessionToken} onUnauthorized={onUnauthorized} />
        </div>
      )}
    </div>
  );
}

export function IncomingTransferPanel({ transfers, loading, error, onDismiss, sessionToken, onUnauthorized }: IncomingTransferPanelProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const handleDismiss = (id: string) => { setDismissed(prev => new Set(prev).add(id)); onDismiss(id); };
  const visible = transfers.filter(t => !dismissed.has(t.id));
  if (visible.length === 0 && !loading && !error) return null;

  return (
    <div className="itp-panel">
      <div className="itp-panel-header">
        <div className="itp-panel-header-left">
          <ArrowDownRight size={16} className="itp-header-icon" />
          <strong>INCOMING TRANSFERS</strong>
          {visible.length > 0 && <span className="itp-count">{visible.length}</span>}
        </div>
        {loading && <span className="itp-loading-dot" />}
      </div>
      {error && <div className="itp-error"><AlertTriangle size={13} /> {error}</div>}
      <div className="itp-cards">
        {visible.map(t => <TransferCard key={t.id} transfer={t} onDismiss={handleDismiss} sessionToken={sessionToken} onUnauthorized={onUnauthorized} />)}
      </div>
    </div>
  );
}
