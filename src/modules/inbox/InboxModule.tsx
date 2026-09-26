import type { ComponentProps } from 'react';
import { ModuleBoundary } from '@/app/ModuleBoundary';
import { AgentInbox } from '@/components/AgentInbox';

// Keep section recovery local: never reload the page or restart the phone.
export function AgentInboxModule(props: ComponentProps<typeof AgentInbox>) {
 return <ModuleBoundary name="Inbox"><AgentInbox {...props} /></ModuleBoundary>;
}
