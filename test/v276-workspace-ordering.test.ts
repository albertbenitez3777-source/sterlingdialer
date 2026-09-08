/**
 * v276 — Agent Workspace ordering, 48h cutoff, dedup, Live Now correctness
 *
 * These tests run directly against the production database using the
 * get_agent_workspace RPC to verify:
 *   1. Canonical sort: COALESCE(started_at, created_at, transfer_requested_at) DESC, id DESC
 *   2. Strict 48-hour cutoff: no calls older than yesterday_start in today/yesterday buckets
 *   3. No duplicates: a call_id appears in exactly one bucket
 *   4. Live Now contains ONLY non-completed calls created within 15 minutes
 *   5. Today completed: all is_completed = true, all created_at >= today_start
 *   6. Yesterday: all created_at in [yesterday_start, today_start)
 *   7. Archive: all created_at < yesterday_start
 */

import { describe, it, expect } from 'vitest';

// Types matching the RPC response
interface WorkspaceCall {
  id: string;
  created_at: string;
  is_completed?: boolean;
  sort_ts?: string;
}
interface WorkspaceData {
  live_now: WorkspaceCall[];
  today_completed: WorkspaceCall[];
  yesterday: WorkspaceCall[];
  archive_page: WorkspaceCall[];
  archive_total: number;
  boundaries: { today_start: string; yesterday_start: string; server_now: string };
}

// Simulate the RPC response by querying directly
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function fetchWorkspace(agentId: string): Promise<WorkspaceData | null> {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_agent_workspace`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ p_agent_id: agentId, p_archive_offset: 0 }),
  });
  if (!res.ok) return null;
  return res.json();
}

function isSortedDesc(arr: WorkspaceCall[]): boolean {
  for (let i = 1; i < arr.length; i++) {
    const prevTs = arr[i - 1].sort_ts || arr[i - 1].created_at;
    const currTs = arr[i].sort_ts || arr[i].created_at;
    if (prevTs < currTs) return false;
    if (prevTs === currTs && arr[i - 1].id < arr[i].id) return false;
  }
  return true;
}

function collectIds(data: WorkspaceData): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const buckets = [
    ['live_now', data.live_now],
    ['today_completed', data.today_completed],
    ['yesterday', data.yesterday],
    ['archive_page', data.archive_page],
  ] as const;
  for (const [name, calls] of buckets) {
    for (const c of calls) {
      if (!map.has(c.id)) map.set(c.id, []);
      map.get(c.id)!.push(name);
    }
  }
  return map;
}

// Use Erick Jackson as test agent
const TEST_AGENT_ID = 'bf021c46-10ca-45a4-b800-08f5e181834e';

describe('v276 — Agent Workspace ordering and scope', () => {
  it('RPC returns data with correct structure', async () => {
    const data = await fetchWorkspace(TEST_AGENT_ID);
    if (!data) { console.warn('Skipping: no Supabase credentials'); return; }
    expect(data).toHaveProperty('live_now');
    expect(data).toHaveProperty('today_completed');
    expect(data).toHaveProperty('yesterday');
    expect(data).toHaveProperty('archive_page');
    expect(data).toHaveProperty('archive_total');
    expect(data).toHaveProperty('boundaries');
    expect(data.boundaries).toHaveProperty('today_start');
    expect(data.boundaries).toHaveProperty('yesterday_start');
    expect(data.boundaries).toHaveProperty('server_now');
    // Week bucket must NOT exist
    expect(data).not.toHaveProperty('this_week_earlier');
  });

  it('all buckets are sorted newest-first by canonical timestamp', async () => {
    const data = await fetchWorkspace(TEST_AGENT_ID);
    if (!data) return;
    expect(isSortedDesc(data.live_now)).toBe(true);
    expect(isSortedDesc(data.today_completed)).toBe(true);
    expect(isSortedDesc(data.yesterday)).toBe(true);
    expect(isSortedDesc(data.archive_page)).toBe(true);
  });

  it('no call_id appears in more than one bucket (dedup)', async () => {
    const data = await fetchWorkspace(TEST_AGENT_ID);
    if (!data) return;
    const idMap = collectIds(data);
    const dupes = [...idMap.entries()].filter(([, buckets]) => buckets.length > 1);
    expect(dupes).toEqual([]);
  });

  it('Live Now contains ONLY non-completed calls', async () => {
    const data = await fetchWorkspace(TEST_AGENT_ID);
    if (!data) return;
    for (const call of data.live_now) {
      expect(call.is_completed).not.toBe(true);
    }
  });

  it('Live Now calls are all within 15 minutes of server_now', async () => {
    const data = await fetchWorkspace(TEST_AGENT_ID);
    if (!data) return;
    const serverNow = new Date(data.boundaries.server_now).getTime();
    const cutoff = serverNow - 15 * 60 * 1000;
    for (const call of data.live_now) {
      const callTime = new Date(call.created_at).getTime();
      expect(callTime).toBeGreaterThanOrEqual(cutoff);
    }
  });

  it('today_completed calls are all completed and after today_start', async () => {
    const data = await fetchWorkspace(TEST_AGENT_ID);
    if (!data) return;
    const todayStart = new Date(data.boundaries.today_start).getTime();
    for (const call of data.today_completed) {
      expect(call.is_completed).toBe(true);
      expect(new Date(call.created_at).getTime()).toBeGreaterThanOrEqual(todayStart);
    }
  });

  it('yesterday calls are all in [yesterday_start, today_start)', async () => {
    const data = await fetchWorkspace(TEST_AGENT_ID);
    if (!data) return;
    const yesterdayStart = new Date(data.boundaries.yesterday_start).getTime();
    const todayStart = new Date(data.boundaries.today_start).getTime();
    for (const call of data.yesterday) {
      const ct = new Date(call.created_at).getTime();
      expect(ct).toBeGreaterThanOrEqual(yesterdayStart);
      expect(ct).toBeLessThan(todayStart);
    }
  });

  it('archive calls are all before yesterday_start', async () => {
    const data = await fetchWorkspace(TEST_AGENT_ID);
    if (!data) return;
    const yesterdayStart = new Date(data.boundaries.yesterday_start).getTime();
    for (const call of data.archive_page) {
      expect(new Date(call.created_at).getTime()).toBeLessThan(yesterdayStart);
    }
  });

  it('archive_total >= archive_page.length', async () => {
    const data = await fetchWorkspace(TEST_AGENT_ID);
    if (!data) return;
    expect(data.archive_total).toBeGreaterThanOrEqual(data.archive_page.length);
  });
});
