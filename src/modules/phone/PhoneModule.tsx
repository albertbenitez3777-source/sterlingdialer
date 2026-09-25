import { FEDERAL_ONE_V2_URL } from "@/app/shared";
import type { ApplicationModel } from "@/app/useApplicationModel";
import { IPhone } from '@/components/IPhone';

export function PhoneModule({ model }: { model: Pick<ApplicationModel, "isStrictOwner" | "session" | "sessionToken" | "atomicLogout" > }) {
const { isStrictOwner, session, sessionToken, atomicLogout } = model;
if (!session?.valid) return null;
return (<>
{!isStrictOwner && <IPhone key={session.agent!.id} agentName={session.agent!.full_name} sessionToken={sessionToken} providerUrl={FEDERAL_ONE_V2_URL} onUnauthorized={atomicLogout} />}
</>);
}
