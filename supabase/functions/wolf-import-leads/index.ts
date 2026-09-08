import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { inQuotes = !inQuotes; }
    else if (line[i] === "," && !inQuotes) { fields.push(current.trim()); current = ""; }
    else { current += line[i]; }
  }
  fields.push(current.trim());
  return fields;
}

function normalizePhone(p: string): string {
  const digits = p.replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits[0] === "1") return "+" + digits;
  return "+" + digits;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    const body = await req.json();
    const { csv_data, source, skip_existing } = body;

    if (!csv_data) {
      return new Response(JSON.stringify({ error: "No csv_data provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lines = csv_data.split("\n").filter((l: string) => l.trim());
    const rows = lines.slice(1);

    const seen = new Map<string, boolean>();
    const leads: any[] = [];

    for (const line of rows) {
      const fields = parseCSVLine(line);
      if (fields.length < 5) continue;
      const [name, phone, address, income, homeValue] = fields;
      const norm = normalizePhone(phone);
      if (seen.has(norm)) continue;
      seen.set(norm, true);
      leads.push({
        name, telephone_original: phone, telephone_normalized: norm,
        address, income_range: income, home_value: homeValue,
        property_information: "", notes: "", original_agent_information: "",
        source: source || "csv_import", custom_fields: {},
        status: "new", is_priority: false, priority_batch_id: "", retry_count: 0,
      });
    }

    const srcLabel = source || "csv_import";
    let totalInserted = 0;
    let totalSkipped = 0;
    const batchSize = 200;

    for (let i = 0; i < leads.length; i += batchSize) {
      const batch = leads.slice(i, i + batchSize);

      if (skip_existing !== false) {
        const phones = batch.map((l: any) => l.telephone_normalized);
        const { data: existing } = await supabase
          .from("leads")
          .select("telephone_normalized")
          .in("telephone_normalized", phones);
        const existingSet = new Set((existing || []).map((r: any) => r.telephone_normalized));
        const newLeads = batch.filter((l: any) => !existingSet.has(l.telephone_normalized));
        totalSkipped += batch.length - newLeads.length;

        if (newLeads.length > 0) {
          const { error } = await supabase.from("leads").insert(newLeads);
          if (error) {
            console.error(`Batch ${i} error:`, error.message);
          } else {
            totalInserted += newLeads.length;
          }
        }
      } else {
        const { error } = await supabase.from("leads").insert(batch);
        if (error) {
          console.error(`Batch ${i} error:`, error.message);
        } else {
          totalInserted += batch.length;
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      total_csv_rows: rows.length,
      unique_phones: leads.length,
      inserted: totalInserted,
      skipped_duplicates: totalSkipped,
      source: srcLabel,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Internal server error", detail: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
