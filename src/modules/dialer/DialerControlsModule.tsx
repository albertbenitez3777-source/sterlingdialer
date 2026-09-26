import type { ComponentProps } from 'react';
import { ModuleBoundary } from '@/app/ModuleBoundary';
import { DialerControls } from '@/components/DialerControls';

// Keep section recovery local: never reload the page or restart the phone.
export function DialerControlsModule(props: ComponentProps<typeof DialerControls>) {
 return <ModuleBoundary name="Call controls"><DialerControls {...props} /></ModuleBoundary>;
}
