import { AgentMonitoring } from '@/modules/monitoring/AgentMonitoring';
import { canMonitor, useMonitoringAttendance } from '@/modules/monitoring/api';
import { ModuleBoundary } from '@/app/ModuleBoundary';
import { SharedWorkspace } from '@/app/SharedWorkspace';
import { useApplicationModel } from '@/app/useApplicationModel';
import { WorkspaceDialogs } from '@/app/WorkspaceDialogs';
import { MatrixField } from '@/components/MatrixField';
import { AgentWorkspace } from '@/modules/agent/AgentWorkspace';
import { LoginScreen } from '@/modules/login/LoginScreen';
import { MainNavigation } from '@/modules/navigation/MainNavigation';
import { StatusBar } from '@/modules/navigation/StatusBar';
import { OwnerDashboard } from '@/modules/owner/OwnerDashboard';
import { PhoneModule } from '@/modules/phone/PhoneModule';

export default function App() {
 const model = useApplicationModel();
 useMonitoringAttendance(model.sessionToken, !!model.session?.valid && !model.isOwner);
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
      {model.activeNav === 'monitoring' && canMonitor(model.isOwner, model.session.agent) ? <AgentMonitoring token={model.sessionToken} /> : model.isOwner ? <OwnerDashboard model={model} /> : <AgentWorkspace model={model} />}
     </ModuleBoundary>
    </div>
   </div>
   <ModuleBoundary name="Dialogs"><WorkspaceDialogs model={model} /></ModuleBoundary>
   <ModuleBoundary name="Phone"><PhoneModule model={model} /></ModuleBoundary>
  </div>
 </>;
}
