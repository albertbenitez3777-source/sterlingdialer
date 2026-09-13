import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {readFileSync} from 'node:fs';
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',c='33333333-3333-4333-8333-333333333333';
const code=stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/federal-one-v2/whatsup.ts',import.meta.url),'utf8')).replace(/^import .*;$/gm,'').replace('export async function','async function')+'; this.handler=whatsUp;';
function setup(role='agent',id=c){const ctx=vm.createContext({});new vm.Script(code).runInContext(ctx);const touched=[];const db={from(table){touched.push(table);return {select(){return this},eq(){return this},order(){return this},limit(){return this},maybeSingle:async()=>({data:{member_a:a,member_b:b}}),then(resolve){resolve({data:[]})},insert(){throw Error('Unexpected write')}};}};return {run:body=>ctx.handler(db,{id,full_name:'Fixture agent',role},body),touched};}
test('another agent cannot read a private conversation',async()=>{const x=setup();const r=await x.run({action:'whatsup_history',room:a});assert.equal(r.status,403);assert.deepEqual(x.touched,['federal_one_conversations']);});
test('owner can review but cannot impersonate a private participant',async()=>{const x=setup('owner');assert.equal((await x.run({action:'whatsup_history',room:a})).status,200);assert.equal((await x.run({action:'whatsup_send',room:a,message:'hello'})).status,403);});
test('participants can read their direct conversation',async()=>{const x=setup('agent',a);assert.equal((await x.run({action:'whatsup_history',room:b})).status,200);});
test('invalid room ids cannot change the query scope',async()=>{const x=setup();assert.equal((await x.run({action:'whatsup_history',room:'team,room_key.neq.team'})).status,403);assert.equal(x.touched.length,0);});
test('executable attachments are rejected before writing',async()=>{const x=setup();assert.equal((await x.run({action:'whatsup_send',room:'team',image_data:'data:image/svg+xml;base64,PHN2Zz4='})).status,400);assert.equal(x.touched.length,0);});

test('owner review cannot silently join another private video call',async()=>{const x=setup('owner');const r=await x.run({action:'whatsup_video_join',room:a});assert.equal(r.status,403);});
