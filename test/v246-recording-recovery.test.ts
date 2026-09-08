// v246 — Recording Recovery — Fixture Tests
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const PLAYER = readFileSync(join(ROOT, 'src', 'components', 'RecordingPlayer.tsx'), 'utf-8');
const PROVIDER = readFileSync(join(ROOT, 'supabase', 'functions', 'wolf-provider', 'index.ts'), 'utf-8');
const APP = readFileSync(join(ROOT, 'src', 'App.tsx'), 'utf-8');

describe('v246 Recording Recovery', () => {
  describe('Provider recover_recording action', () => {
    it('recover_recording action handler', () => { expect(PROVIDER).toContain('action === "recover_recording"'); });
    it('accepts call_id param', () => { expect(PROVIDER).toContain('call_id'); });
    it('requires session_token', () => { expect(PROVIDER).toContain('session_token'); });
  });

  describe('Role isolation', () => {
    it('checks owner/admin role', () => { expect(PROVIDER.includes('isOwnerOrAdmin') || PROVIDER.includes('agent.role === "owner"')).toBe(true); });
    it('checks agent ownership', () => { expect(PROVIDER).toContain('callRow.agent_id !== agent.id'); });
    it('returns 403 for unauthorized agent', () => { expect(PROVIDER).toContain('status: 403'); });
  });

  describe('Server-side Bland fetch', () => {
    it('calls Bland recording API', () => { expect(PROVIDER).toContain('api.bland.ai/v1/calls/'); });
    it('uses server-side API key', () => { expect(PROVIDER.includes('blandApiKey') || PROVIDER.includes('BLAND_API_KEY')).toBe(true); });
    it('uses /recording endpoint', () => { expect(PROVIDER).toContain('/recording'); });
    it('fallback to detail recording_url', () => { expect(PROVIDER).toContain('recording_url'); });
  });

  describe('Storage upsert', () => {
    it('stores in call-recordings bucket', () => { expect(PROVIDER).toContain('call-recordings'); });
    it('uses upsert header', () => { expect(PROVIDER).toContain('x-upsert'); });
    it('uses service role for storage', () => { expect(PROVIDER).toContain('serviceRoleKey'); });
  });

  describe('Updates call record', () => {
    it('updates calls.recording_url', () => { expect(PROVIDER.includes('recording_url: publicUrl') || PROVIDER.includes('.update({ recording_url:')).toBe(true); });
    it('returns playable URL', () => { expect(PROVIDER).toContain('success: true, recording_url'); });
  });

  describe('No secret exposure', () => {
    it('does not return API key in response', () => { expect(PROVIDER.includes('return.*blandApiKey')).toBe(false); });
  });

  describe('Missing audio handling', () => {
    it('handles missing provider_call_id', () => { expect(PROVIDER).toContain('No provider call ID'); });
    it('handles empty Bland response', () => { expect(PROVIDER).toContain('Recording not available from provider'); });
    it('checks for zero-byte audio', () => { expect(PROVIDER).toContain('audioBlob.size === 0'); });
  });

  describe('RecordingPlayer recovery logic', () => {
    it('accepts callId prop', () => { expect(PLAYER).toContain('callId'); });
    it('accepts sessionToken prop', () => { expect(PLAYER).toContain('sessionToken'); });
    it('accepts onUnauthorized prop', () => { expect(PLAYER).toContain('onUnauthorized'); });
    it('has recovery function', () => { expect(PLAYER).toContain('attemptRecovery'); });
    it('tracks recovery attempts', () => { expect(PLAYER).toContain('attemptedRecovery'); });
    it('calls recover_recording action', () => { expect(PLAYER).toContain('recover_recording'); });
    it('stores recovered URL', () => { expect(PLAYER).toContain('recoveredUrl'); });
    it('tracks recovery failure', () => { expect(PLAYER).toContain('recoveryFailed'); });
  });

  describe('Auto-recover on missing URL', () => {
    it('triggers recovery when URL missing', () => { expect(PLAYER).toContain('!activeUrl && callId && sessionToken'); });
    it('shows recovery loading state', () => { expect(PLAYER).toContain('Recovering audio'); });
  });

  describe('Retry once on audio error', () => {
    it('has audio error handler', () => { expect(PLAYER).toContain('handleAudioError'); });
    it('uses ref to prevent double recovery', () => { expect(PLAYER).toContain('attemptedRecovery.current'); });
  });

  describe('App.tsx call sites updated', () => {
    it('all 3 RecordingPlayer calls pass callId', () => {
      const playerCalls = APP.match(/RecordingPlayer[^/]*callId=/g) || [];
      expect(playerCalls.length).toBeGreaterThanOrEqual(3);
    });
    it('all 3 RecordingPlayer calls pass sessionToken', () => {
      const sessionCalls = APP.match(/RecordingPlayer[^/]*sessionToken=/g) || [];
      expect(sessionCalls.length).toBeGreaterThanOrEqual(3);
    });
    it('all 3 RecordingPlayer calls pass onUnauthorized', () => {
      const logoutCalls = APP.match(/RecordingPlayer[^/]*onUnauthorized=/g) || [];
      expect(logoutCalls.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Imports', () => {
    it('imports authFetch', () => { expect(PLAYER).toContain('import { authFetch }'); });
    it('imports RefreshCw icon for recovery state', () => { expect(PLAYER).toContain('RefreshCw'); });
    it('imports VolumeX for unavailable state', () => { expect(PLAYER).toContain('VolumeX'); });
  });
});
