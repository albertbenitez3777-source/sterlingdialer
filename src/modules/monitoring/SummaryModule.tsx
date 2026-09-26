import type { ComponentProps } from 'react';
import { ModuleBoundary } from '@/app/ModuleBoundary';
import { TeamSnapshot } from '@/modules/monitoring/TeamSnapshot';
import { AdminLiveStatus } from '@/modules/owner/AdminLiveStatus';

// Keep section recovery local: never reload the page or restart the phone.
export function TeamSnapshotModule(props: ComponentProps<typeof TeamSnapshot>) {
 return <ModuleBoundary name="Team snapshot"><TeamSnapshot {...props} /></ModuleBoundary>;
}
export function AdminLiveStatusModule(props: ComponentProps<typeof AdminLiveStatus>) {
 return <ModuleBoundary name="Live status"><AdminLiveStatus {...props} /></ModuleBoundary>;
}
