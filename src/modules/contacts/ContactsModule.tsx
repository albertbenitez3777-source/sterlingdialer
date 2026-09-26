import type { ComponentProps } from 'react';
import { ModuleBoundary } from '@/app/ModuleBoundary';
import { ContactsView } from '@/app/views/ContactsView';

// Keep section recovery local: never reload the page or restart the phone.
export function ContactsViewModule(props: ComponentProps<typeof ContactsView>) {
 return <ModuleBoundary name="Contacts"><ContactsView {...props} /></ModuleBoundary>;
}
