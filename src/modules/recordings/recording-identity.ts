// A renewed playback grant is still the same recording. Do not key a player by
// an expiring signature; switching call/source/account must still reset it.
export function recordingIdentity(source:string,callId:string|undefined,url:string|null|undefined,sessionToken:string|undefined):string {
 let resource=url||'';
 if(!callId&&resource){try{const parsed=new URL(resource);if(parsed.pathname.startsWith('/storage/v1/object/sign/'))resource=parsed.origin+parsed.pathname;}catch{/* Preserve unknown references verbatim. */}}
 return JSON.stringify([source,callId||resource,sessionToken||'']);
}
