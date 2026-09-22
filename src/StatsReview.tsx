import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {OperationsView,type OperationsOverview} from './components/OperationsDashboard';
import './index.css';
import './operations-theme.css';
const data: OperationsOverview = {
 as_of:new Date().toISOString(),since:'2026-09-22T06:00:00Z',timezone:'America/Costa_Rica',events_enabled:true,events_since:'2026-09-22T13:26:00Z',last_event_at:new Date().toISOString(),voicemail_import_configured:true,
 campaign:{state:'running',call_limit:200,accepted:85,concurrency:7},lines:{configured:7,effective:7,active:7,reserved:0,aged:0,hourly_target:400,minute_limit:7,recent_hour:85,recent_minute:7,pacing_allowance:0,available_slots:0,agent_slots:0,selected_agents:1,eligible_agents:1,blocking_reason:''},
 bland:{attempts:500,humans:72,transfers:36,destination_dialed:34,bridge_confirmed:18,in_progress:7,no_answer:300,customer_voicemail:121,failures:2,minutes:120.5,linked_received:30,linked_answered:18,linked_voicemail:12},
 zadarma:{incoming:35,outgoing:6,outgoing_answered:3,answered:18,voicemail_reached:12,missed:5,ringing:0,connected:0,unconfirmed:0,linked_transfers:30,unlinked_incoming:5},voicemail:{messages:10,unheard:4,unheard_backlog:8},outcomes:{human:72,no_answer:300,customer_voicemail:121,in_progress:7},
 agents:[{id:'one',full_name:'Agent One',status:'active',selected:true,phone_ready:false,route_ready:true,zadarma_number:'+12025550101',attempts:300,humans:42,transfers:20,in_progress:7,incoming:20,answered:10,transfer_answers:10,voicemail_reached:8,missed:2,messages:7,unheard:3,unheard_backlog:6,callbacks:3},{id:'two',full_name:'Agent Two',status:'active',selected:false,phone_ready:true,route_ready:false,zadarma_number:'+12025550102',attempts:200,humans:30,transfers:16,in_progress:0,incoming:15,answered:8,transfer_answers:8,voicemail_reached:4,missed:3,messages:3,unheard:1,unheard_backlog:2,callbacks:1}],
 hourly:[0,0,0,0,0,0,0,85,26,101,200,81,7].map((attempts,i)=>({hour:new Date(Date.UTC(2026,8,22,6+i)).toISOString(),attempts,humans:[0,0,0,0,0,0,0,10,4,16,22,20,0][i],transfers:[0,0,0,0,0,0,0,3,0,2,0,31,0][i]})),
 recent_calls:[{pbx_call_id:'sample1',full_name:'Agent One',direction:'inbound',caller_number:'+12025550103',called_number:'+12025550101',started_at:new Date().toISOString(),disposition:'answered',voicemail_reached:false,answered:true,duration_seconds:70,linked_transfer:true}]
};
function Review(){const [w,setW]=useState('today');return <main className="f1-v2-shell" style={{maxWidth:1280,margin:'0 auto',padding:24}}><p style={{fontSize:12,color:'#dbc5d1'}}>LAYOUT VERIFICATION · FICTIONAL SAMPLE DATA · NO CALLS</p><OperationsView data={data} busy={false} error="" windowName={w} onWindow={setW} onRefresh={()=>{}}/></main>}
createRoot(document.getElementById('root')!).render(<Review/>);
