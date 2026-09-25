import type { ApplicationModel } from "@/app/useApplicationModel";
import { WhatsUp } from '@/components/WhatsUp';

export function ChatModule({ model }: { model: Pick<ApplicationModel, "sessionToken" | "session" | "atomicLogout" > }) {
const { sessionToken, session, atomicLogout } = model;
if (!session?.valid) return null;
return (<>
<WhatsUp sessionToken={sessionToken} agentId={session.agent!.id} onUnauthorized={atomicLogout} />
</>);
}
