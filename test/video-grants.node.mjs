import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {AccessToken,TokenVerifier} from 'livekit-server-sdk';
function load(config){const source=stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/federal-one-v2/video.ts',import.meta.url),'utf8')).replace(/^import .*;$/gm,'').replaceAll('export ','');const ctx=vm.createContext({URL,AccessToken,Deno:{env:{get:k=>config[k]}}});new vm.Script(source+';this.create=createVideoGrant;this.config=videoConfiguration;').runInContext(ctx);return ctx;}
test('missing configuration returns no grant',async()=>{const x=load({});const r=await x.create({id:'agent-a',full_name:'Agent A'},'team');assert.equal(r.status,503);assert.equal(r.data.token,undefined);});
test('video grants expire and authorize exactly one room without admin powers',async()=>{const x=load({LIVEKIT_URL:'wss://fixture.example.test',LIVEKIT_API_KEY:'fixture-key',LIVEKIT_API_SECRET:'fixture-secret-that-is-at-least-32-characters',SUPABASE_URL:'https://fixture.supabase.co'});const r=await x.create({id:'agent-a',full_name:'Agent A'},'private-room');assert.equal(r.status,200);const claims=await new TokenVerifier('fixture-key','fixture-secret-that-is-at-least-32-characters').verify(r.data.token);assert.equal(claims.sub,'agent-a');assert.equal(claims.video.room,'fixture-private-room');assert.equal(claims.video.roomJoin,true);assert.notEqual(claims.video.roomAdmin,true);assert.notEqual(claims.video.roomRecord,true);assert.equal(claims.video.canPublishData,false);assert.ok(claims.exp-Math.floor(Date.now()/1000)<=601);});
test('insecure media endpoints cannot issue tokens',async()=>{const x=load({LIVEKIT_URL:'ws://fixture',LIVEKIT_API_KEY:'x',LIVEKIT_API_SECRET:'y'});assert.equal((await x.create({id:'a',full_name:'A'},'team')).status,503);});
