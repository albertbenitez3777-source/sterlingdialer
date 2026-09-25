import { FEDERAL_ONE_V2_URL } from "@/app/shared";
import type { ApplicationModel } from "@/app/useApplicationModel";
import { PhoneActionModal } from "@/app/views/PhoneActionModal";
import { RedialConfirmModal } from '@/components';
import {
Phone,PhoneOff,
X
} from 'lucide-react';

export function WorkspaceDialogs({ model }: { model: Pick<ApplicationModel, "phoneAction" | "isStrictOwner" | "setPhoneAction" | "placeQuickSecretaryCall" | "placingQuickSecretaryCall" | "sessionToken" | "atomicLogout" | "isOwner" | "showRedialModal" | "setShowRedialModal" | "setPendingRedialAction" | "setRedialModalError" | "redialPreview" | "confirmRedial" | "redialingAgent" | "redialingHumans" | "redialModalError" | "showOfflineModal" | "setShowOfflineModal" | "handleToggleAvailability" | "togglingAvail" > }) {
const { phoneAction, isStrictOwner, setPhoneAction, placeQuickSecretaryCall, placingQuickSecretaryCall, sessionToken, atomicLogout, isOwner, showRedialModal, setShowRedialModal, setPendingRedialAction, setRedialModalError, redialPreview, confirmRedial, redialingAgent, redialingHumans, redialModalError, showOfflineModal, setShowOfflineModal, handleToggleAvailability, togglingAvail } = model;
return (<>
{phoneAction && (
        <PhoneActionModal
          name={phoneAction.name} phone={phoneAction.phone} email={phoneAction.email} address={phoneAction.address}
          canCall={!isStrictOwner}
          onClose={() => setPhoneAction(null)}
          onSecretaryCall={() => placeQuickSecretaryCall(phoneAction.name, phoneAction.phone)}
          placingSecretaryCall={placingQuickSecretaryCall}
          providerUrl={FEDERAL_ONE_V2_URL}
          sessionToken={sessionToken}
          onUnauthorized={atomicLogout}
        />
      )}
{isOwner && (
        <RedialConfirmModal
          open={showRedialModal}
          onClose={() => { setShowRedialModal(false); setPendingRedialAction(null); setRedialModalError(null); }}
          preview={redialPreview}
          onConfirm={confirmRedial}
          dialing={redialingAgent !== null || redialingHumans !== null}
          error={redialModalError}
        />
      )}
{showOfflineModal && !isStrictOwner && (
        <div className="modal-overlay" onClick={() => setShowOfflineModal(false)}>
          <div className="offline-modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowOfflineModal(false)}><X size={18} /></button>
            <PhoneOff size={32} className="offline-modal-icon" />
            <h2>You are OFFLINE</h2>
            <p>You will NOT receive any calls until you tap <strong>Go Available</strong>.</p>
            <button className="primary-button go-available-btn" onClick={() => { handleToggleAvailability(); }} disabled={togglingAvail}>
              {togglingAvail ? 'Switching...' : <><Phone size={14} /> Go Available</>}
            </button>
            <button className="secondary-button stay-offline-btn" onClick={() => setShowOfflineModal(false)}>
              Stay Offline
            </button>
          </div>
        </div>
      )}
</>);
}
