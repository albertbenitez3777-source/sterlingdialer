import type { ComponentProps } from 'react';
import { ModuleBoundary } from '@/app/ModuleBoundary';
import { OpportunitiesFeed } from '@/components/OpportunitiesFeed';

// Keep section recovery local: never reload the page or restart the phone.
export function OpportunitiesFeedModule(props: ComponentProps<typeof OpportunitiesFeed>) {
 return <ModuleBoundary name="Callbacks"><OpportunitiesFeed {...props} /></ModuleBoundary>;
}
