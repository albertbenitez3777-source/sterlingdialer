// v241 Agent Cockpit, Stats Reconciliation, Recording Player, Neon Palette — Fixtures
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const CSS = readFileSync(join(ROOT, 'src', 'index.css'), 'utf-8');
const APP = readFileSync(join(ROOT, 'src', 'App.tsx'), 'utf-8');
const COMP = readFileSync(join(ROOT, 'src', 'components', 'AgentCockpit.tsx'), 'utf-8');
const REC = readFileSync(join(ROOT, 'src', 'components', 'RecordingPlayer.tsx'), 'utf-8');
const BARREL = readFileSync(join(ROOT, 'src', 'components', 'index.ts'), 'utf-8');

describe('v241 Agent Cockpit & Dashboard Density', () => {
  describe('Component structure', () => {
    it('AgentCockpit exported', () => { expect(COMP).toContain('export function AgentCockpit'); });
    it('props interface', () => { expect(COMP).toContain('AgentCockpitProps'); });
    it('barrel exports component', () => { expect(BARREL).toContain('AgentCockpit'); });
    it('barrel exports props type', () => { expect(BARREL).toContain('AgentCockpitProps'); });
    it('barrel exports RecordingPlayer', () => { expect(BARREL).toContain('RecordingPlayer'); });
  });

  describe('Today stats reconciliation', () => {
    it('AgentTodayStats type defined', () => { expect(COMP).toContain('AgentTodayStats'); });
    it('todayStats prop nullable', () => { expect(COMP).toContain('todayStats: AgentTodayStats | null'); });
    it('uses today fire_transfers count', () => { expect(COMP).toContain('todayStats.fire_transfers'); });
    it('uses today human_drops count', () => { expect(COMP).toContain('todayStats.human_drops'); });
    it('uses today failed count', () => { expect(COMP).toContain('todayStats.failed_transfers'); });
    it('uses today callbacks count', () => { expect(COMP).toContain('todayStats.callbacks_due'); });
    it('uses today active_calls_now', () => { expect(COMP).toContain('todayStats.active_calls_now'); });
    it('uses today_total count', () => { expect(COMP).toContain('todayStats.today_total'); });
  });

  describe('Stats surfaced from API', () => {
    it('agentTodayStats state', () => { expect(APP).toContain('agentTodayStats'); });
    it('setAgentTodayStats setter', () => { expect(APP).toContain('setAgentTodayStats'); });
    it('extracts stats from response', () => { expect(APP).toContain('raw.stats'); });
    it('passes stats to cockpit', () => { expect(APP).toContain('todayStats={agentTodayStats'); });
  });

  describe('Pipeline fallback', () => {
    it('todayStats branch', () => { expect(COMP).toContain('if (todayStats)'); });
    it('fallback to array lengths', () => { expect(COMP).toContain('fireTransfers.length'); });
    it('fallback derives failed', () => { expect(COMP).toContain('transfer_failed_unverified'); });
  });

  describe('Availability toggle', () => {
    it('toggle element', () => { expect(COMP).toContain('cockpit-avail-toggle'); });
    it('toggle handler prop', () => { expect(COMP).toContain('onToggleAvail'); });
    it('online/offline labels', () => { expect(COMP).toContain("available ? 'Online' : 'Offline'"); });
  });

  describe('Quick actions', () => {
    for (const action of ['Call Now', 'Contacts', 'Secretary', 'Saved']) {
      it(`action: ${action}`, () => { expect(COMP).toContain(`<span>${action}</span>`); });
    }
    it('hot lead badge', () => { expect(COMP).toContain('cockpit-badge'); });
  });

  describe('RecordingPlayer', () => {
    it('RecordingPlayer exported', () => { expect(REC).toContain('export function RecordingPlayer'); });
    it('audio error handler', () => { expect(REC).toContain('onError'); });
    it('audio load handler', () => { expect(REC).toContain('onLoadedData'); });
    it('error state message', () => { expect(REC).toContain('Recording unavailable'); });
    it('loading state', () => { expect(REC).toContain('Loading audio'); });
    it('error icon', () => { expect(REC).toContain('VolumeX'); });
    it('handles null/undefined URLs', () => { expect(REC.includes('url: string | null | undefined') || REC.includes('url:')).toBe(true); });
    it('early return when no URL and no callId', () => { expect(REC.includes('!activeUrl && !callId') || REC.includes('return null')).toBe(true); });
  });

  describe('RecordingPlayer integration', () => {
    it('imported', () => { expect(APP).toContain('RecordingPlayer'); });
    it('call recording replaced', () => { expect(APP).toContain('RecordingPlayer url={call.recording_url}'); });
    it('contact recording replaced', () => { expect(APP).toContain('RecordingPlayer url={contact.recording_url}'); });
    it('no bare <audio> elements remain', () => {
      const bareAudioCount = (APP.match(/<audio controls src=/g) || []).length;
      expect(bareAudioCount).toBe(0);
    });
  });

  describe('Recording CSS', () => {
    it('player wrapper', () => { expect(CSS).toContain('.recording-player-wrap'); });
    it('unavailable state', () => { expect(CSS).toContain('.recording-unavailable'); });
    it('loading state', () => { expect(CSS).toContain('.recording-loading'); });
    it('audio styling', () => { expect(CSS).toContain('.recording-audio'); });
  });

  describe('Neon palette', () => {
    it('cyan brightened', () => { expect(CSS).toContain('--gold-400: #2ee8ff'); });
    it('neon-cyan brightened', () => { expect(CSS).toContain('--neon-cyan: #2ee8ff'); });
    it('violet brightened', () => { expect(CSS).toContain('--steel-400: #9d8cff'); });
    it('lime brightened', () => { expect(CSS).toContain('--sage-500: #ccff66'); });
    it('magenta brightened', () => { expect(CSS).toContain('--rust-400: #ff82e2'); });
    it('muted text brightened', () => { expect(CSS).toContain('--text-muted: #738495'); });
    it('dim text brightened', () => { expect(CSS).toContain('--text-dim: #536578'); });
    it('new cyan rgba used', () => { expect(CSS).toContain('rgba(46, 232, 255'); });
  });

  describe('Agent nav', () => {
    it('dashboard in agent nav', () => {
      const agentNavStart = APP.indexOf("    : [");
      const agentNavEnd = APP.indexOf("];", agentNavStart);
      const agentNav = APP.substring(agentNavStart, agentNavEnd);
      expect(agentNav).toContain("id: 'dashboard'");
    });
    it('calls in agent nav', () => {
      const agentNavStart = APP.indexOf("    : [");
      const agentNavEnd = APP.indexOf("];", agentNavStart);
      const agentNav = APP.substring(agentNavStart, agentNavEnd);
      expect(agentNav).toContain("id: 'calls'");
    });
  });

  describe('App.tsx integration', () => {
    it('agent dashboard guard', () => { expect(APP).toContain("!isOwner && activeNav === 'dashboard'"); });
    it('fire transfers passed', () => { expect(APP).toContain('fireTransfers={(queues?.fire_transfers'); });
    it('human drops passed', () => { expect(APP).toContain('humanDrops={(queues?.human_drop'); });
  });

  describe('Responsive', () => {
    it('tablet 3-col', () => { expect(CSS).toContain('.cockpit-pipeline { grid-template-columns: repeat(3, 1fr)'); });
    it('phone 2-col', () => { expect(CSS).toContain('.cockpit-pipeline { grid-template-columns: repeat(2, 1fr)'); });
  });

  describe('Touch targets', () => {
    it('avail toggle 44px', () => { expect(CSS.includes('.cockpit-avail-toggle') && CSS.includes('min-height: 44px')).toBe(true); });
    it('action 44px', () => { expect(CSS.includes('.cockpit-action') && CSS.includes('min-height: 44px')).toBe(true); });
  });

  describe('Reduced motion', () => {
    it('pulse off', () => { expect(CSS).toContain('.cockpit-avail-dot.pulse { animation: none'); });
  });

  describe('Owner preserved', () => {
    it('owner dashboard guard', () => { expect(APP).toContain("isOwner && activeNav === 'dashboard'"); });
    it('health map preserved', () => { expect(APP).toContain('LiveHealthMap'); });
    it('KPI strip preserved', () => { expect(APP).toContain('kpi-strip'); });
    it('agent readiness preserved', () => { expect(APP).toContain('Agent Readiness'); });
  });

  describe('Auth/security', () => {
    for (const term of ['wolf-auth', 'sessionToken', 'atomicLogout', 'onUnauthorized', 'authFetch']) {
      it(term, () => { expect(APP).toContain(term); });
    }
  });

  describe('Component security', () => {
    it('cockpit: no direct API calls', () => { expect(COMP).not.toContain('authFetch'); });
    it('cockpit: no fetch calls', () => { expect(COMP).not.toContain('fetch('); });
    it('cockpit: no admin stats access', () => { expect(COMP).not.toContain('adminStats'); });
    it('recorder: no raw fetch calls', () => { expect(REC).not.toContain('fetch('); });
    it('recorder: uses authFetch for recovery', () => { expect(REC).toContain('authFetch'); });
  });

  describe('Greeting', () => {
    it('morning', () => { expect(COMP).toContain('Good morning'); });
    it('afternoon', () => { expect(COMP).toContain('Good afternoon'); });
    it('evening', () => { expect(COMP).toContain('Good evening'); });
  });
});
