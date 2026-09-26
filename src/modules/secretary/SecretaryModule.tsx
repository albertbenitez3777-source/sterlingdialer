import type { ComponentProps } from 'react';
import { ModuleBoundary } from '@/app/ModuleBoundary';
import { SecretaryView } from '@/app/views/SecretaryView';

// Keep section recovery local: never reload the page or restart the phone.
export function SecretaryViewModule(props: ComponentProps<typeof SecretaryView>) {
 return <ModuleBoundary name="Assistant calls"><SecretaryView {...props} /></ModuleBoundary>;
}
