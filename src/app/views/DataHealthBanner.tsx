import { DataHealth } from "@/app/shared";
import {
Check,
RefreshCw,
WifiOff
} from 'lucide-react';
export function DataHealthBanner({ health }: { health: DataHealth }) {
  if (health.status === 'healthy' && health.lastSuccess) {
    const ago = Math.round((Date.now() - health.lastSuccess) / 1000);
    return (
      <div className="data-health-banner healthy">
        <Check size={14} /> Live data healthy · last refreshed {ago}s ago
      </div>
    );
  }
  if (health.status === 'loading') {
    return (
      <div className="data-health-banner loading">
        <RefreshCw size={14} className="search-spinner" /> Loading dashboard data...
      </div>
    );
  }
  if (health.status === 'degraded') {
    return (
      <div className="data-health-banner degraded">
        <WifiOff size={14} /> Data degraded — {health.failedAction} failed: {health.failedMessage || 'unknown error'}.
        Showing last known good data.
      </div>
    );
  }
  return null;
}
