import { createHash, createHmac, timingSafeEqual } from "node:crypto";

type Database = { from: (table: string) => any; rpc: (name: string, args: Record<string, unknown>) => Promise<any> };
type Dependencies = { db: Database; env: (name: string) => string | undefined; fetcher?: typeof fetch; now?: () => number };
const PURPOSE = "zadarma-history.";
const MAX_PAGES = 3;
const PAGE_SIZE = 1000;
const response = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
export function signRequest(path: string, params: Record<string,string>, secret: string) {
  const query = new URLSearchParams(Object.entries(params).sort(([a],[b]) => a.localeCompare(b))).toString();
  const digest = createHash("md5").update(query).digest("hex");
  return { query, signature: btoa(createHmac("sha1",secret).update(path + query + digest).digest("hex")) };
}
export function providerDate(time: number) {
  return new Date(time - 6 * 60 * 60 * 1000).toISOString().slice(0,19).replace("T"," ");
}
class HistoryError extends Error {
  constructor(public code: string, public status = 502) { super(code); }
}
async function boundedBody(req: Request) {
  if (Number(req.headers.get("content-length") || 0) > 4096) throw new HistoryError("BODY_TOO_LARGE",413);
  if (!req.body) return "";
  const reader = req.body.getReader(); const chunks: Uint8Array[] = []; let size=0;
  while (true) {
    const part=await reader.read(); if(part.done)break;
    size += part.value.byteLength;
    if(size>4096){await reader.cancel();throw new HistoryError("BODY_TOO_LARGE",413);}
    chunks.push(part.value);
  }
  const bytes=new Uint8Array(size); let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return new TextDecoder().decode(bytes);
}
export function makeHandler({ db, env, fetcher=fetch, now=Date.now }: Dependencies) {
  return async (req: Request): Promise<Response> => {
    if(req.method!=="POST")return response(405,{ok:false,code:"METHOD_NOT_ALLOWED"});
    const timestamp=req.headers.get("x-history-timestamp") || "";
    const signature=req.headers.get("x-history-signature") || "";
    if(!/^\d{10}$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(signature) || Math.abs(now()/1000-Number(timestamp))>300)
      return response(401,{ok:false,code:"UNAUTHORIZED"});
    let authenticated=false;
    try {
      const raw=await boundedBody(req);
      const envKey=env("ZADARMA_API_KEY"), envSecret=env("ZADARMA_API_SECRET");
      const settingKeys=["dialer_scheduler_secret"];
      if(!envKey || !envSecret)settingKeys.push("zadarma_api_key","zadarma_api_secret");
      const settings=await db.from("system_config").select("key,value").in("key",settingKeys);
      if(settings.error)throw new HistoryError("SETTINGS_UNAVAILABLE",503);
      const config=Object.fromEntries((settings.data || []).map((r:any)=>[r.key,r.value]));
      const schedulerSecret=String(config.dialer_scheduler_secret || "");
      if(schedulerSecret.length<32)throw new HistoryError("SCHEDULER_AUTH_UNAVAILABLE",503);
      const expected=createHmac("sha256",schedulerSecret).update(PURPOSE+timestamp+"."+raw).digest("hex");
      if(!timingSafeEqual(new TextEncoder().encode(expected),new TextEncoder().encode(signature)))
        return response(401,{ok:false,code:"UNAUTHORIZED"});
      authenticated=true;
      let body:any; try{body=JSON.parse(raw);}catch{throw new HistoryError("INVALID_JSON",400);}
      const end=Date.parse(body.end), start=Date.parse(body.start);
      if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end||end-start>86400000||end>now()+60000||start<now()-7*86400000)
        throw new HistoryError("INVALID_HISTORY_WINDOW",400);
      if(body.dry_run!==undefined && typeof body.dry_run!=="boolean")throw new HistoryError("INVALID_DRY_RUN",400);
      const key=envKey || config.zadarma_api_key, secret=envSecret || config.zadarma_api_secret;
      if(!key||!secret)throw new HistoryError("PROVIDER_AUTH_UNAVAILABLE",503);
      async function request(path:string, params:Record<string,string>) {
        const signed=signRequest(path,params,String(secret));
        const result=await fetcher("https://api.zadarma.com"+path+"?"+signed.query,{method:"GET",headers:{Authorization:String(key)+":"+signed.signature},signal:AbortSignal.timeout(15000)});
        if(!result.ok)throw new HistoryError("PROVIDER_HTTP_"+result.status,result.status===429?429:502);
        const data=await result.json();
        if(data.status!=="success")throw new HistoryError("PROVIDER_REJECTED_REQUEST");
        return data;
      }
      const timezone=await request("/v1/info/timezone/",{});
      if(!/^UTC-0?6(?::00)?$/.test(String(timezone.timezone)))throw new HistoryError("PROVIDER_TIMEZONE_MISMATCH",409);
      const stats:unknown[]=[]; let pages=0; let complete=false;
      for(let page=0;page<MAX_PAGES;page++) {
        const result=await request("/v1/statistics/pbx/",{start:providerDate(start),end:providerDate(end),version:"2",skip:String(page*PAGE_SIZE),limit:String(PAGE_SIZE)});
        if(!Array.isArray(result.stats)||result.stats.length>PAGE_SIZE)throw new HistoryError("INVALID_PROVIDER_HISTORY");
        stats.push(...result.stats); pages++;
        if(result.stats.length<PAGE_SIZE){complete=true;break;}
      }
      if(!complete)throw new HistoryError("HISTORY_WINDOW_TOO_LARGE",409);
      if(body.dry_run)return response(200,{ok:true,dry_run:true,provider_rows:stats.length,pages,provider_timezone:timezone.timezone});
      const applied=await db.rpc("apply_verified_zadarma_call_history",{p_stats:stats,p_start:new Date(start).toISOString(),p_end:new Date(end).toISOString()});
      if(applied.error)throw new HistoryError("HISTORY_APPLY_FAILED",503);
      return response(200,{ok:true,provider_rows:stats.length,pages,...applied.data});
    } catch(error) {
      const code=error instanceof HistoryError?error.code:error instanceof Error && (error.name==="TimeoutError"||error.name==="AbortError")?"PROVIDER_TIMEOUT":"HISTORY_UNAVAILABLE";
      if(authenticated)await db.from("system_config").upsert([
        {key:"zadarma_history_last_error",value:code},
        {key:"zadarma_history_last_attempt_at",value:new Date(now()).toISOString()}
      ],{onConflict:"key"}).then(()=>{},()=>{});
      return response(error instanceof HistoryError?error.status:503,{ok:false,code});
    }
  };
}

