// Expensive reports belong to their visible page. Phone registration, incoming
// calls and attendance heartbeats run independently and are not paused here.
export type WorkspaceRead = 'admin' | 'team' | 'roster' | 'activity' | 'redial' | 'leads'
  | 'queues' | 'alerts' | 'transfers' | 'secretary' | 'saved';
export function workspaceReads(owner: boolean, page: string, tab: string): WorkspaceRead[] {
  if (owner) {
    if (page === 'dashboard') return ['admin'];
    if (page === 'leads') return ['leads'];
    if (page !== 'system') return [];
    if (tab === 'overview') return ['admin', 'roster', 'team'];
    if (tab === 'agents') return ['admin', 'roster', 'activity', 'team'];
    if (tab === 'redial') return ['admin', 'redial', 'team'];
    return ['admin', 'team'];
  }
  if (page === 'monitoring') return [];
  const reads: WorkspaceRead[] = ['queues', 'alerts', 'transfers'];
  if (page === 'secretary') reads.push('secretary');
  if (page === 'saved') reads.push('saved');
  return reads;
}

export async function refreshWorkspace(
  reads: WorkspaceRead[],
  loaders: Record<WorkspaceRead, (signal: AbortSignal) => Promise<boolean | void>>,
  signal: AbortSignal,
  stopOnFailure = true,
) {
  // A slow secondary report cannot delay setting the essential data, and an
  // unavailable backend does not receive the rest of the batch at once.
  let healthy = true;
  for (const read of reads) {
    if (signal.aborted) return false;
    if (await loaders[read](signal) === false) {
      healthy = false;
      if (stopOnFailure) return false;
    }
  }
  return healthy && !signal.aborted;
}
