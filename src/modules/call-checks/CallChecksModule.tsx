import type { ComponentProps } from 'react';
import { ModuleBoundary } from '@/app/ModuleBoundary';
import { TestCallPanel } from '@/components/TestCallPanel';
import { InboundVerificationPanel } from '@/components/InboundVerificationPanel';

// Keep section recovery local: never reload the page or restart the phone.
export function TestCallPanelModule(props: ComponentProps<typeof TestCallPanel>) {
 return <ModuleBoundary name="Call checks"><TestCallPanel {...props} /></ModuleBoundary>;
}
export function InboundVerificationPanelModule(props: ComponentProps<typeof InboundVerificationPanel>) {
 return <ModuleBoundary name="Inbound checks"><InboundVerificationPanel {...props} /></ModuleBoundary>;
}
