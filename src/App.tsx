import { useApplicationModel } from '@/app/useApplicationModel';
import { LoginScreen } from '@/modules/login/LoginScreen';
import { MainNavigation } from '@/modules/navigation/MainNavigation';
import { StatusBar } from '@/modules/navigation/StatusBar';
import { OwnerDashboard } from '@/modules/owner/OwnerDashboard';
import { AgentWorkspace } from '@/modules/agent/AgentWorkspace';
import { SharedWorkspace } from '@/app/SharedWorkspace';
import { WorkspaceDialogs } from '@/app/WorkspaceDialogs';
import { PhoneModule } from '@/modules/phone/PhoneModule';
import { ChatModule } from '@/modules/chat/ChatModule';
import { CameraModule } from '@/modules/camera/CameraModule';
import { ModuleBoundary } from '@/app/ModuleBoundary';
import { MatrixField } from '@/components/MatrixField';

export default function App() {
 const model = useApplicationModel();
 if (model.ownerNeedsSetup || !model.session?.valid) return <LoginScreen model={model} />;
 return <>
  <div className="app-shell f1-v2-shell">
   <MatrixField density="ops" />
   <ModuleBoundary name="Navigation"><MainNavigation model={model} /></ModuleBoundary>
   <div className="content-area">
    <ModuleBoundary name="Status"><StatusBar model={model} /></ModuleBoundary>
    <div className="content-wrap">
     <ModuleBoundary name="Workspace tools"><SharedWorkspace model={model} /></ModuleBoundary>
     <ModuleBoundary name="Workspace" resetKey={model.isOwner ? 'owner' : 'agent'}>
      {model.isOwner ? <OwnerDashboard model={model} /> : <AgentWorkspace model={model} />}
     </ModuleBoundary>
    </div>
   </div>
   <ModuleBoundary name="Dialogs"><WorkspaceDialogs model={model} /></ModuleBoundary>
   <ModuleBoundary name="Chat"><ChatModule model={model} /></ModuleBoundary>
   <ModuleBoundary name="Phone"><PhoneModule model={model} /></ModuleBoundary>
  </div>
  <ModuleBoundary name="Camera"><CameraModule model={model} /></ModuleBoundary>
 </>;
}
