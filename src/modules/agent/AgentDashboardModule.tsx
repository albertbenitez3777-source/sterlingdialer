import type { ComponentProps } from 'react';
import { ModuleBoundary } from '@/app/ModuleBoundary';
import { AgentCockpit } from '@/components/AgentCockpit';

// Keep section recovery local: never reload the page or restart the phone.
export function AgentCockpitModule(props: ComponentProps<typeof AgentCockpit>) {
 return <ModuleBoundary name="Agent dashboard"><AgentCockpit {...props} /></ModuleBoundary>;
}
