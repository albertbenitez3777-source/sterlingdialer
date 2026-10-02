import { FEDERAL_ONE_V2_URL } from "@/app/shared";
import type { ApplicationModel } from "@/app/useApplicationModel";
import { IPhone } from '@/components/IPhone';

// Temporarily hide the legacy Zadarma desktop phone. Keep the module intact for a reversible return.
const SHOW_ZADARMA_DESKTOP_PHONE = false;

export function PhoneModule({ model }: { model: Pick<ApplicationModel, "isStrictOwner" | "session" | "sessionToken" | "atomicLogout" > }) {
const { isStrictOwner, session, sessionToken, atomicLogout } = model;
if (!session?.valid || !SHOW_ZADARMA_DESKTOP_PHONE) return null;
return (<>
{!isStrictOwner && <IPhone key={session.agent!.id} agentName={session.agent!.full_name} sessionToken={sessionToken} providerUrl={FEDERAL_ONE_V2_URL} onUnauthorized={atomicLogout} />}
</>);
}
