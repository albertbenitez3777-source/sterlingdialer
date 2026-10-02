import {useState} from 'react';
import {CallbackScheduleModule} from './CallbackSchedule';
import {CALLBACK_PARTICIPANTS} from './callback-agents';

export function OwnerCallbackSchedule({sessionToken,onUnauthorized,compact=false}:{sessionToken:string;onUnauthorized:()=>void;compact?:boolean}) {
 const [agentId,setAgentId]=useState<string>(CALLBACK_PARTICIPANTS[0].id);
 return <div className="f1-owner-callback-workspace">
  <div className="f1-callback-agent-selector" role="group" aria-label="Choose agent callback schedule">
   {CALLBACK_PARTICIPANTS.map(agent=><button type="button" key={agent.id} aria-pressed={agentId===agent.id} onClick={()=>setAgentId(agent.id)}>{agent.name}</button>)}
  </div>
  <CallbackScheduleModule sessionToken={sessionToken} agentId={agentId} onUnauthorized={onUnauthorized} ownerView compact={compact}/>
 </div>;
}
