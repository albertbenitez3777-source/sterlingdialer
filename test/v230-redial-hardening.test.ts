// v230 Historical Performance & Cross-Agent Redial Hardening — Regression Tests
// Verifies: server-side preview, attribution columns, exclusion logic, pagination,
// UI selectors, timeframe filter, Talkroute-HUB-only routing, no direct-number fallback.
// Mock-only — no database, no network, no production mutations, no calls placed.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = join(import.meta.dirname, '..');
const APP_TSC = readFileSync(join(PROJECT_ROOT, 'src', 'App.tsx'), 'utf-8');
const CSS_TSC = readFileSync(join(PROJECT_ROOT, 'src', 'index.css'), 'utf-8');
const PROVIDER_TSC = readFileSync(join(PROJECT_ROOT, 'supabase', 'functions', 'wolf-provider', 'index.ts'), 'utf-8');

// Helper: extract section between two action strings (handles both quote styles)
function sectionBetween(startAction: string, endAction: string): string {
  const startIdx = PROVIDER_TSC.indexOf(startAction);
  const endIdx = PROVIDER_TSC.indexOf(endAction);
  if (startIdx === -1 || endIdx === -1) return '';
  return PROVIDER_TSC.substring(startIdx, endIdx);
}

const PREVIEW_SECTION = sectionBetween('action === "redial_preview"', 'action === "redial_live_transfers"');
const TRANSFERS_SECTION = sectionBetween('action === "redial_live_transfers"', 'action === "redial_live_humans"');
const HUMANS_SECTION = sectionBetween('action === "redial_live_humans"', 'action === "redial_progress"');
const REDIAL_SECTION = TRANSFERS_SECTION + HUMANS_SECTION;

describe('v230 Historical Performance & Cross-Agent Redial Hardening', () => {
  // ── 1. Server-side redial_preview action exists ───────────────────────────
  it('redial_preview action exists in wolf-provider', () => { expect(PREVIEW_SECTION.length > 0).toBe(true); });
  it('preview response includes dry_run: true', () => { expect(PREVIEW_SECTION.includes('dry_run: true')).toBe(true); });
  it('preview returns eligible_count', () => { expect(PREVIEW_SECTION.includes('eligible_count')).toBe(true); });
  it('preview returns excluded_count', () => { expect(PREVIEW_SECTION.includes('excluded_count')).toBe(true); });
  it('preview returns excluded_reasons array', () => { expect(PREVIEW_SECTION.includes('excluded_reasons')).toBe(true); });
  it('preview returns can_proceed boolean', () => { expect(PREVIEW_SECTION.includes('can_proceed')).toBe(true); });
  it('preview returns campaign_active', () => { expect(PREVIEW_SECTION.includes('campaign_active')).toBe(true); });
  it('preview returns has_active_batch', () => { expect(PREVIEW_SECTION.includes('has_active_batch')).toBe(true); });
  it('preview returns capped_count', () => { expect(PREVIEW_SECTION.includes('capped_count')).toBe(true); });
  it('preview returns total_source_records', () => { expect(PREVIEW_SECTION.includes('total_source_records')).toBe(true); });
  it('preview returns unique_phones', () => { expect(PREVIEW_SECTION.includes('unique_phones')).toBe(true); });
  it('preview returns source_agent_name', () => { expect(PREVIEW_SECTION.includes('source_agent_name')).toBe(true); });
  it('preview returns target_agent_name', () => { expect(PREVIEW_SECTION.includes('target_agent_name')).toBe(true); });
  it('preview returns cohort_type', () => { expect(PREVIEW_SECTION.includes('cohort_type')).toBe(true); });

  // ── 2. Preview does NOT create calls or contact provider ──────────────────
  it('preview does not insert calls', () => { expect(PREVIEW_SECTION.includes('.from("calls").insert(')).toBe(false); });
  it('preview does not contact Bland API', () => { expect(PREVIEW_SECTION.includes('api.bland.ai')).toBe(false); });
  it('preview does not fetch from Bland', () => { expect(PREVIEW_SECTION.includes('fetch("https://api.bland.ai')).toBe(false); });

  // ── 3. Attribution columns on redial insert (transfers) ───────────────────
  it('original_agent_id set on transfer redial insert', () => { expect(TRANSFERS_SECTION.includes('original_agent_id:')).toBe(true); });
  it('redial_of set on transfer redial insert', () => { expect(TRANSFERS_SECTION.includes('redial_of:')).toBe(true); });
  it('redial_source_type set on transfer redial insert', () => { expect(TRANSFERS_SECTION.includes('redial_source_type:')).toBe(true); });
  it('redial_batch_id set on transfer redial insert', () => { expect(TRANSFERS_SECTION.includes('redial_batch_id:')).toBe(true); });
  it('redial_source_type is "live_transfers" for transfer redials', () => { expect(TRANSFERS_SECTION.includes('redial_source_type: "live_transfers"')).toBe(true); });

  // ── 4. Attribution columns on redial insert (humans) ──────────────────────
  it('original_agent_id set on human redial insert', () => { expect(HUMANS_SECTION.includes('original_agent_id:')).toBe(true); });
  it('redial_of set on human redial insert', () => { expect(HUMANS_SECTION.includes('redial_of:')).toBe(true); });
  it('redial_source_type set on human redial insert', () => { expect(HUMANS_SECTION.includes('redial_source_type:')).toBe(true); });
  it('redial_batch_id set on human redial insert', () => { expect(HUMANS_SECTION.includes('redial_batch_id:')).toBe(true); });
  it('redial_source_type is "live_humans" for human redials', () => { expect(HUMANS_SECTION.includes('redial_source_type: "live_humans"')).toBe(true); });

  // ── 5. redial_count increment preserved ───────────────────────────────────
  it('redial_count incremented by 1', () => { expect(PROVIDER_TSC.includes('currentRedialCount + 1')).toBe(true); });
  it('redial_count set on insert', () => { expect(PROVIDER_TSC.includes('redial_count: currentRedialCount + 1')).toBe(true); });

  // ── 6. No 1000-row truncation — paginated fetch ───────────────────────────
  it('paginated fetch uses pageOffset in transfers', () => { expect(TRANSFERS_SECTION.includes('pageOffset')).toBe(true); });
  it('paginated fetch uses pageSize in transfers', () => { expect(TRANSFERS_SECTION.includes('pageSize')).toBe(true); });
  it('paginated fetch uses .range() in transfers', () => { expect(TRANSFERS_SECTION.includes('.range(')).toBe(true); });
  it('no .limit(1000) truncation in transfers source fetch', () => { expect(TRANSFERS_SECTION.includes('.limit(1000)')).toBe(false); });
  it('paginated fetch uses pageOffset in humans', () => { expect(HUMANS_SECTION.includes('pageOffset')).toBe(true); });
  it('paginated fetch uses pageSize in humans', () => { expect(HUMANS_SECTION.includes('pageSize')).toBe(true); });
  it('paginated fetch uses .range() in humans', () => { expect(HUMANS_SECTION.includes('.range(')).toBe(true); });
  it('no .limit(1000) truncation in humans source fetch', () => { expect(HUMANS_SECTION.includes('.limit(1000)')).toBe(false); });

  // ── 7. redial_progress also paginated ─────────────────────────────────────
  it('redial_progress uses pageOffset', () => {
    const progressSection = sectionBetween('action === "redial_progress"', 'action === "redial_stats"');
    expect(progressSection.includes('pageOffset')).toBe(true);
  });
  it('redial_progress uses .range()', () => {
    const progressSection = sectionBetween('action === "redial_progress"', 'action === "redial_stats"');
    expect(progressSection.includes('.range(')).toBe(true);
  });
  it('no .limit(1000) in redial_progress', () => {
    const progressSection = sectionBetween('action === "redial_progress"', 'action === "redial_stats"');
    expect(progressSection.includes('.limit(1000)')).toBe(false);
  });

  // ── 8. Exclusion logic in preview ─────────────────────────────────────────
  it('DNC exclusion check exists', () => { expect(PREVIEW_SECTION.includes('is_dnc')).toBe(true); });
  it('wrong number exclusion check exists', () => { expect(PREVIEW_SECTION.includes('is_wrong_number')).toBe(true); });
  it('lead-table DNC/suppressed exclusion check exists', () => { expect(PREVIEW_SECTION.includes('suppressed')).toBe(true); });
  it('pending/active call exclusion check exists', () => { expect(PREVIEW_SECTION.includes('queue', 'pending')).toBe(true); });
  it('cross-batch dedup exclusion exists', () => { expect(PREVIEW_SECTION.includes('redial_batch')).toBe(true); });
  it('redial cap exclusion exists', () => { expect(PREVIEW_SECTION.includes('redial_count')).toBe(true); });
  it('duplicate phone exclusion exists', () => { expect(PREVIEW_SECTION.includes('Duplicate phone number')).toBe(true); });
  it('batch cap exclusion exists', () => { expect(PREVIEW_SECTION.includes('Exceeds') || PREVIEW_SECTION.includes('exceeds')).toBe(true); });

  // ── 9. Active batch 409 guard ─────────────────────────────────────────────
  it('hasActiveBatch variable in preview', () => { expect(PREVIEW_SECTION.includes('hasActiveBatch')).toBe(true); });
  it('has_active_batch returned in preview response', () => { expect(PREVIEW_SECTION.includes('has_active_batch: hasActiveBatch')).toBe(true); });
  it('can_proceed includes !hasActiveBatch guard', () => { expect(PREVIEW_SECTION.includes('!hasActiveBatch')).toBe(true); });

  // ── 10. Talkroute-HUB-only routing (no direct-number fallback) ─────────────
  it('transferRoute is "hub" in redial handlers', () => { expect(REDIAL_SECTION.includes('const transferRoute = "hub"')).toBe(true); });
  it('no direct route in redial handlers', () => { expect(REDIAL_SECTION.includes('transferRoute = "direct"')).toBe(false); });
  it('no agent_direct_number used for transferRoute assignment', () => { expect(REDIAL_SECTION.includes('transferRoute = agent_direct_number')).toBe(false); });
  it('no agent_direct_number used as transfer_destination', () => { expect(REDIAL_SECTION.includes('transfer_destination: agent_direct_number')).toBe(false); });

  // ── 11. Owner authorization on preview ────────────────────────────────────
  it('verifySession called in preview', () => { expect(PREVIEW_SECTION.includes('verifySession')).toBe(true); });
  it('owner/administrator role check in preview', () => { expect(PREVIEW_SECTION.includes('isReadAdmin')).toBe(true); });
  it('403 status for non-owner in preview', () => { expect(PREVIEW_SECTION.includes('403')).toBe(true); });

  // ── 12. UI: independent source/target selectors ────────────────────────────
  it('redialSourceAgent state exists', () => { expect(APP_TSC.includes('redialSourceAgent')).toBe(true); });
  it('setRedialSourceAgent exists', () => { expect(APP_TSC.includes('setRedialSourceAgent')).toBe(true); });
  it('source agent select dropdown in UI', () => { expect(APP_TSC.includes('redial-source-select')).toBe(true); });
  it('source selector label present', () => { expect(APP_TSC.includes('Dial contacts from:')).toBe(true); });
  it('otherAgents computed for dropdown options', () => { expect(APP_TSC.includes('otherAgents')).toBe(true); });
  it('source agent mapping is per-target-agent', () => { expect(APP_TSC.includes('[agent.id]: e.target.value')).toBe(true); });

  // ── 13. UI: timeframe filter (Today/Week/All Time) ─────────────────────────
  it('redialTimeframe state exists', () => { expect(APP_TSC.includes('redialTimeframe')).toBe(true); });
  it('Today button exists', () => { expect(APP_TSC.includes("setRedialTimeframe('today')")).toBe(true); });
  it('This Week button exists', () => { expect(APP_TSC.includes("setRedialTimeframe('week')")).toBe(true); });
  it('All Time button exists', () => { expect(APP_TSC.includes("setRedialTimeframe('all')")).toBe(true); });
  it('timeframe bar CSS class in JSX', () => { expect(APP_TSC.includes('redial-timeframe-bar')).toBe(true); });
  it('timeframe button CSS class in JSX', () => { expect(APP_TSC.includes('redial-timeframe-btn')).toBe(true); });

  // ── 14. UI: truthful historical metrics per agent ──────────────────────────
  it('attempts today field used', () => { expect(APP_TSC.includes('outbound_attempts_today')).toBe(true); });
  it('attempts week field used', () => { expect(APP_TSC.includes('outbound_attempts_week')).toBe(true); });
  it('attempts all-time field used', () => { expect(APP_TSC.includes('outbound_attempts_all')).toBe(true); });
  it('transfers requested all-time used', () => { expect(APP_TSC.includes('transfers_requested_all')).toBe(true); });
  it('transfers requested week used', () => { expect(APP_TSC.includes('transfers_requested_week')).toBe(true); });
  it('talkroute leg created today used', () => { expect(APP_TSC.includes('talkroute_leg_created_today')).toBe(true); });
  it('talkroute leg created week used', () => { expect(APP_TSC.includes('talkroute_leg_created_week')).toBe(true); });
  it('talkroute leg created all-time used', () => { expect(APP_TSC.includes('talkroute_leg_created_all')).toBe(true); });
  it('talkroute answered all-time used', () => { expect(APP_TSC.includes('talkroute_answered_all')).toBe(true); });
  it('bridge confirmed all-time used', () => { expect(APP_TSC.includes('bridge_confirmed_all')).toBe(true); });
  it('historical grid CSS class in JSX', () => { expect(APP_TSC.includes('redial-historical-grid')).toBe(true); });
  it('rh-stat CSS class in JSX', () => { expect(APP_TSC.includes('rh-stat')).toBe(true); });

  // ── 15. UI: server-side preview call (not local) ───────────────────────────
  it('openRedialModal calls redial_preview action', () => { expect(APP_TSC.includes("action: 'redial_preview'")).toBe(true); });
  it('preview call passes redial_type', () => { expect(APP_TSC.includes('redial_type: type')).toBe(true); });
  it('preview call passes source_agent_id', () => { expect(APP_TSC.includes('source_agent_id: sourceAgentId')).toBe(true); });
  it('preview call passes target_agent_id', () => { expect(APP_TSC.includes('target_agent_id: agentId')).toBe(true); });

  // ── 16. UI: PREVIEW button text (not direct dial) ──────────────────────────
  it('transfer button says PREVIEW TRANSFER REDIAL', () => { expect(APP_TSC.includes('PREVIEW TRANSFER REDIAL')).toBe(true); });
  it('human button says PREVIEW HUMAN REDIAL', () => { expect(APP_TSC.includes('PREVIEW HUMAN REDIAL')).toBe(true); });
  it('old direct-dial button text removed', () => { expect(APP_TSC.includes('RE-DIAL {Math.min(sourceTransfers')).toBe(false); });

  // ── 17. AdminStats type includes new fields ───────────────────────────────
  it('outbound_attempts_all in AdminAgentRow type', () => { expect(APP_TSC.includes('outbound_attempts_all')).toBe(true); });
  it('transfers_requested_all in type', () => { expect(APP_TSC.includes('transfers_requested_all')).toBe(true); });
  it('transfers_requested_week in type', () => { expect(APP_TSC.includes('transfers_requested_week')).toBe(true); });
  it('talkroute_leg_created_today in type', () => { expect(APP_TSC.includes('talkroute_leg_created_today')).toBe(true); });
  it('talkroute_leg_created_week in type', () => { expect(APP_TSC.includes('talkroute_leg_created_week')).toBe(true); });
  it('talkroute_leg_created_all in type', () => { expect(APP_TSC.includes('talkroute_leg_created_all')).toBe(true); });
  it('talkroute_answered_all in type', () => { expect(APP_TSC.includes('talkroute_answered_all')).toBe(true); });
  it('bridge_confirmed_all in type', () => { expect(APP_TSC.includes('bridge_confirmed_all')).toBe(true); });

  // ── 18. CSS: timeframe bar, historical grid, 44px targets, reduced-motion ─
  it('redial-timeframe-bar CSS exists', () => { expect(CSS_TSC.includes('.redial-timeframe-bar')).toBe(true); });
  it('redial-timeframe-btn CSS exists', () => { expect(CSS_TSC.includes('.redial-timeframe-btn')).toBe(true); });
  it('redial-historical-grid CSS exists', () => { expect(CSS_TSC.includes('.redial-historical-grid')).toBe(true); });
  it('rh-stat CSS exists', () => { expect(CSS_TSC.includes('.rh-stat')).toBe(true); });
  it('44px min-height for touch targets', () => { expect(CSS_TSC.includes('min-height: 44px')).toBe(true); });
  it('reduced-motion support exists', () => { expect(CSS_TSC.includes('prefers-reduced-motion')).toBe(true); });
  it('760px responsive breakpoint exists', () => { expect(CSS_TSC.includes('@media (max-width: 760px)')).toBe(true); });

  // ── 19. Migration columns exist in DB ─────────────────────────────────────
  it('original_agent_id used in edge function', () => { expect(PROVIDER_TSC.includes('original_agent_id')).toBe(true); });
  it('redial_of used in edge function', () => { expect(PROVIDER_TSC.includes('redial_of')).toBe(true); });
  it('redial_source_type used in edge function', () => { expect(PROVIDER_TSC.includes('redial_source_type')).toBe(true); });
  it('redial_batch_id used in edge function', () => { expect(PROVIDER_TSC.includes('redial_batch_id')).toBe(true); });

  // ── 20. Source totals unchanged (no overwrite of old rows) ─────────────────
  it('update only on new redial rows by attempt.id', () => { expect(REDIAL_SECTION.includes('.eq("id", attempt.id)')).toBe(true); });
  it('no update on source agent calls', () => { expect(REDIAL_SECTION.includes('.eq("agent_id", _sourceAgentId).update(')).toBe(false); });

  // ── 21. No purple/indigo in CSS ────────────────────────────────────────────
  it('No purple in CSS', () => { expect(CSS_TSC.includes('purple')).toBe(false); });
  it('No indigo in CSS', () => { expect(CSS_TSC.includes('indigo')).toBe(false); });

  // ── 22. Error/finally cleanup in openRedialModal ──────────────────────────
  it('setRedialModalError called on error', () => { expect(APP_TSC.includes('setRedialModalError')).toBe(true); });
  it('setRedialModalLoading(false) in finally', () => { expect(APP_TSC.includes('setRedialModalLoading(false)')).toBe(true); });
  it('Network error message in catch', () => { expect(APP_TSC.includes('Network error')).toBe(true); });

  // ── 23. Disabled launch until preview succeeds ─────────────────────────────
  it('modal checks cappedCount/canProceed', () => { expect(APP_TSC.includes('cappedCount') || APP_TSC.includes('canProceed')).toBe(true); });
  it('RedialConfirmModal has canProceed check', () => {
    const modalPath = join(PROJECT_ROOT, 'src', 'components', 'RedialConfirmModal.tsx');
    const modalTsc = readFileSync(modalPath, 'utf-8');
    expect(modalTsc.includes('canProceed')).toBe(true);
  });
  it('canProceed checks cappedCount > 0', () => {
    const modalPath = join(PROJECT_ROOT, 'src', 'components', 'RedialConfirmModal.tsx');
    const modalTsc = readFileSync(modalPath, 'utf-8');
    expect(modalTsc.includes('preview.cappedCount > 0')).toBe(true);
  });
  it('modal shows loading when no preview', () => {
    const modalPath = join(PROJECT_ROOT, 'src', 'components', 'RedialConfirmModal.tsx');
    const modalTsc = readFileSync(modalPath, 'utf-8');
    expect(modalTsc.includes('!preview')).toBe(true);
  });
});
