import type { ComponentProps } from 'react';
import { ModuleBoundary } from '@/app/ModuleBoundary';
import { IncomingCallAlert } from '@/components/IncomingCallAlert';
import { IncomingTransferPanel } from '@/components/IncomingTransferPanel';

// Keep section recovery local: never reload the page or restart the phone.
export function IncomingCallAlertModule(props: ComponentProps<typeof IncomingCallAlert>) {
 return <ModuleBoundary name="Transfer alerts"><IncomingCallAlert {...props} /></ModuleBoundary>;
}
export function IncomingTransferPanelModule(props: ComponentProps<typeof IncomingTransferPanel>) {
 return <ModuleBoundary name="Incoming transfers"><IncomingTransferPanel {...props} /></ModuleBoundary>;
}
