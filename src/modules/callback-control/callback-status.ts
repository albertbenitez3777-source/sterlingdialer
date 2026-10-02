export type CallbackWaitingReasons = {
  outside_calling_window: number;
  wait_30_minutes: number;
  call_in_progress: number;
};

type StatusData = {
  day: string;
  today: string;
  booking_block?: string;
  counts: {ready: number; active: number; waiting: number};
  waiting_reasons?: CallbackWaitingReasons;
  run: null | {state: string; reason: string};
};

export function callbackStatus(data: StatusData | null, stale: boolean) {
  if (!data) return {label: 'LOADING STATUS', tone: '', message: ''};
  if (data.day !== data.today) return {label: 'SAVED HISTORY', tone: '', message: 'This is a saved list, not the current callback run.'};
  if (stale) return {label: 'STATUS NEEDS REFRESH', tone: 'waiting', message: 'The latest callback status could not be confirmed. Refresh to check it. Stop remains available for an active run.'};
  const running = data.run?.state === 'running';
  if (!running) return {
    label: data.run?.state === 'attention' ? 'NEEDS REVIEW' : data.run?.state === 'completed' ? 'LIST FINISHED' : 'STOPPED',
    tone: data.run?.state === 'attention' ? 'waiting' : '',
    message: data.run?.reason || '',
  };
  if (data.counts.active > 0) return {label: 'CALLING NOW', tone: 'running', message: `${data.counts.active} callback attempt(s) are connecting or in progress.`};
  if (data.booking_block) return {label: 'WAITING FOR APPOINTMENT CAPACITY', tone: 'waiting', message: data.booking_block};
  if (data.counts.ready === 0 && data.counts.waiting > 0) {
    const reasons = data.waiting_reasons;
    const parts: string[] = [];
    if (reasons?.outside_calling_window) parts.push(`${reasons.outside_calling_window} waiting for permitted calling hours`);
    if (reasons?.wait_30_minutes) parts.push(`${reasons.wait_30_minutes} waiting for the retry interval`);
    if (reasons?.call_in_progress) parts.push(`${reasons.call_in_progress} waiting for another call to finish`);
    return {
      label: reasons?.outside_calling_window === data.counts.waiting ? 'WAITING FOR CALLING HOURS' : 'WAITING TO CALL',
      tone: 'waiting',
      message: `No contacts are eligible to call right now. ${parts.length ? parts.join(' · ') : `${data.counts.waiting} contacts are waiting`}. Your list is saved. This run stops when today ends in Costa Rica.`,
    };
  }
  if (data.counts.ready === 0) return {label: 'NO ELIGIBLE CONTACTS', tone: 'waiting', message: 'No new callbacks are available in this list. Finished and excluded contacts remain saved.'};
  return {label: 'PREPARING CALLBACKS', tone: 'waiting', message: `${data.counts.ready} contacts are ready. Waiting for dispatch, an open line, or the current provider pace limit.`};
}
