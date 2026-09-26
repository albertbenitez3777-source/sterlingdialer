import type { ComponentProps } from 'react';
import { ModuleBoundary } from '@/app/ModuleBoundary';
import { ExtraInfo } from '@/components/ExtraInfo';

// Keep section recovery local: never reload the page or restart the phone.
export function ExtraInfoModule(props: ComponentProps<typeof ExtraInfo>) {
 return <ModuleBoundary name="Contact research"><ExtraInfo {...props} /></ModuleBoundary>;
}
