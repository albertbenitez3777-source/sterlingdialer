import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { makeHandler } from "./handler.ts";

const url=Deno.env.get("SUPABASE_URL") || "";
const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(makeHandler({db,env:name=>Deno.env.get(name)}));

