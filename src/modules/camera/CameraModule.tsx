import { FEDERAL_ONE_V2_URL } from "@/app/shared";
import type { ApplicationModel } from "@/app/useApplicationModel";
import CameraWidget from '@/components/CameraWidget';

export function CameraModule({ model }: { model: Pick<ApplicationModel, "isOwner" | "session" | "sessionToken" > }) {
const { isOwner, session, sessionToken } = model;
if (!session?.valid) return null;
return (<>
<CameraWidget isOwner={isOwner} agentId={session.agent!.id} agentName={session.agent!.full_name} sessionToken={sessionToken} providerUrl={FEDERAL_ONE_V2_URL} />
</>);
}
