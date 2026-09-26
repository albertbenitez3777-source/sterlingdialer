import type { ComponentProps } from 'react';
import { ModuleBoundary } from '@/app/ModuleBoundary';
import { CallLogView } from '@/app/views/CallLogView';
import { SavedTransfersView } from '@/app/views/SavedTransfersView';
import { AdminSavedTransfersView } from '@/app/views/AdminSavedTransfersView';

// Keep section recovery local: never reload the page or restart the phone.
export function CallLogViewModule(props: ComponentProps<typeof CallLogView>) {
 return <ModuleBoundary name="Call history"><CallLogView {...props} /></ModuleBoundary>;
}
export function SavedTransfersViewModule(props: ComponentProps<typeof SavedTransfersView>) {
 return <ModuleBoundary name="Saved calls"><SavedTransfersView {...props} /></ModuleBoundary>;
}
export function AdminSavedTransfersViewModule(props: ComponentProps<typeof AdminSavedTransfersView>) {
 return <ModuleBoundary name="Team saved calls"><AdminSavedTransfersView {...props} /></ModuleBoundary>;
}
