import React, { useEffect } from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({inbox:false,report:false,transfersMounted:0,transfersUnmounted:0}));
vi.mock('@/components/AgentInbox',()=>({AgentInbox:()=>{if(state.inbox)throw Error('synthetic inbox failure');return <span>Inbox content</span>;}}));
vi.mock('@/components/IncomingTransferPanel',()=>({IncomingTransferPanel:()=>{useEffect(()=>{state.transfersMounted++;return()=>{state.transfersUnmounted++;};},[]);return <span>Incoming transfers remain visible</span>;}}));
vi.mock('@/components/OperationsDashboard',()=>({OperationsDashboard:()=>{if(state.report)throw Error('synthetic report failure');return <span>Statistics content</span>;}}));
vi.mock('@/app/views/ContactsView',()=>({ContactsView:()=> <span>Contacts content</span>}));
import { AgentWorkspace } from '../src/modules/agent/AgentWorkspace';
import { OwnerDashboard } from '../src/modules/owner/OwnerDashboard';
let root: ReturnType<typeof create>|undefined;
beforeEach(()=>{state.inbox=false;state.report=false;state.transfersMounted=0;state.transfersUnmounted=0;vi.spyOn(console,'error').mockImplementation(()=>{});});
afterEach(()=>{if(root)act(()=>root!.unmount());root=undefined;vi.restoreAllMocks();});
const agentModel=()=>({session:{valid:true,agent:{id:'synthetic',full_name:'Test Agent',role:'agent'}},isOwner:false,activeNav:'inbox',isOnline:true,agentAvailable:true,transferAlerts:[],activeTransfers:[],sessionToken:'synthetic',setDismissedTransferIds:vi.fn(),setActiveNav:vi.fn()}) as any;
it('contains inbox failure without hiding or remounting incoming transfers',()=>{
 const model=agentModel();act(()=>{root=create(<AgentWorkspace model={model}/>);});
 state.inbox=true;act(()=>root!.update(<AgentWorkspace model={{...model}}/>));
 expect(root!.root.findAllByProps({'aria-label':'Inbox unavailable'})).toHaveLength(1);
 expect(JSON.stringify(root!.toJSON())).toContain('Incoming transfers remain visible');
 expect(state.transfersMounted).toBe(1);expect(state.transfersUnmounted).toBe(0);
});
it('retries only the failed inbox section',()=>{
 state.inbox=true;act(()=>{root=create(<AgentWorkspace model={agentModel()}/>);});
 state.inbox=false;act(()=>root!.root.findByProps({className:'secondary-button'}).props.onClick());
 expect(JSON.stringify(root!.toJSON())).toContain('Inbox content');
 expect(state.transfersMounted).toBe(1);expect(state.transfersUnmounted).toBe(0);
});
it('can open contacts after an inbox failure without a page reload',()=>{
 const model=agentModel();state.inbox=true;act(()=>{root=create(<AgentWorkspace model={model}/>);});
 act(()=>root!.update(<AgentWorkspace model={{...model,activeNav:'contacts'}}/>));
 expect(JSON.stringify(root!.toJSON())).toContain('Contacts content');
 expect(root!.root.findAllByProps({'aria-label':'Inbox unavailable'})).toHaveLength(0);
 expect(state.transfersUnmounted).toBe(0);
});
it('keeps owner call-control loading and retry available after statistics rendering fails',()=>{
 const refresh=vi.fn();const model={isOwner:true,activeNav:'system',dashTab:'overview',adminStats:null,dataHealth:{status:'degraded',lastSuccess:null},loadAdminStats:refresh,sessionToken:'synthetic'} as any;
 state.report=true;act(()=>{root=create(<OwnerDashboard model={model}/>);});
 expect(root!.root.findAllByProps({'aria-label':'Call statistics unavailable'})).toHaveLength(1);
 const controls=root!.root.findByProps({'aria-label':'Dialer controls loading'});
 act(()=>controls.findByType('button').props.onClick());expect(refresh).toHaveBeenCalledWith('synthetic');
});
