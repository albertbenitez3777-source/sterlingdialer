import { OwnerCallbackSchedule } from "@/modules/callback-schedule/OwnerCallbackSchedule";
import { OpportunitiesFeedModule } from '@/modules/callbacks/CallbacksModule';
import { ExtraInfoModule } from '@/modules/research/ResearchModule';
import type { ApplicationModel } from "@/app/useApplicationModel";
import { DataHealthBanner } from "@/app/views/DataHealthBanner";


import {
Check,
PhoneOff,
X
} from 'lucide-react';

export function SharedWorkspace({ model }: { model: Pick<ApplicationModel, "dialerError" | "setDialerError" | "notice" | "setNotice" | "availToast" | "setAvailToast" | "isOwner" | "activeNav" | "dataHealth" | "sessionToken" | "atomicLogout" | "setSecClientName" | "setSecClientPhone" | "setActiveNav" | "extraInfoPrefill" | "session" > }) {
const { dialerError, setDialerError, notice, setNotice, availToast, setAvailToast, isOwner, activeNav, dataHealth, sessionToken, atomicLogout, setSecClientName, setSecClientPhone, setActiveNav, extraInfoPrefill } = model;
return (<>
{dialerError && <div className="toast" role="alert"><PhoneOff size={14} />{dialerError}<button aria-label="Dismiss dialer error" onClick={() => setDialerError('')}><X size={14} /></button></div>}
{notice && (
            <div className="toast">
              <Check size={14} />
              {notice}
              <button onClick={() => setNotice('')}><X size={14} /></button>
            </div>
          )}
{availToast && (
            <div className="toast avail-toast-offline">
              <PhoneOff size={14} />
              {availToast}
              <button onClick={() => setAvailToast('')}><X size={14} /></button>
            </div>
          )}
{((isOwner && ['dashboard', 'system'].includes(activeNav)) || (!isOwner && activeNav === 'dashboard')) && (
            <DataHealthBanner health={dataHealth} />
          )}
{isOwner && activeNav === 'callbacks' && <OwnerCallbackSchedule sessionToken={sessionToken} onUnauthorized={atomicLogout} />}
{activeNav === 'opportunities' && (
            <OpportunitiesFeedModule
              sessionToken={sessionToken}
              onUnauthorized={atomicLogout}
              isOwner={isOwner}
              agentId={model.session?.agent?.id ?? ''}
              onCallback={(name, phone) => {
                setSecClientName(name);
                setSecClientPhone(phone);
                setActiveNav('secretary');
              }}
            />
          )}
{activeNav === 'extra' && (
            <ExtraInfoModule sessionToken={sessionToken} onUnauthorized={atomicLogout} prefill={extraInfoPrefill} />
          )}
</>);
}
