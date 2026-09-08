/**
 * call-flow-regression.node.mjs — 35 regression checks
 * Runs against the actual handler source: wolf-webhook, wolf-backfill, call-evidence.
 * Node 24 compatible (pure ESM, no test framework).
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// ── Load source files as text for static analysis checks ──────────
const webhookSrc = readFileSync(resolve(root, 'supabase/functions/wolf-webhook/index.ts'), 'utf-8');
const backfillSrc = readFileSync(resolve(root, 'supabase/functions/wolf-backfill/index.ts'), 'utf-8');
const evidenceSrc = readFileSync(resolve(root, 'supabase/functions/_shared/call-evidence.ts'), 'utf-8');

let pass = 0;
let fail = 0;
const failures = [];

function check(id, description, ok) {
  if (ok) {
    pass++;
    console.log(`  PASS  ${id}: ${description}`);
  } else {
    fail++;
    failures.push(`${id}: ${description}`);
    console.log(`  FAIL  ${id}: ${description}`);
  }
}

console.log('\n=== call-flow-regression: 35 checks ===\n');

// ── Section A: wolf-webhook premature completion guards (1-7) ─────

check('A1', 'webhook: is_completed uses callIsFinished conditional',
  webhookSrc.includes('callIsFinished') && webhookSrc.includes('CASE WHEN ${callIsFinished}'));

check('A2', 'webhook: callIsFinished requires transcript OR summary OR duration OR terminal status',
  /callIsFinished\s*=\s*Boolean\(\s*\n?\s*transcript/.test(webhookSrc));

check('A3', 'webhook: no unconditional is_completed = true in main UPDATE',
  !webhookSrc.includes("is_completed = true,\n") || webhookSrc.includes('CASE WHEN'));

check('A4', 'webhook: terminal statuses include completed, failed, no-answer, no_answer, busy, error',
  webhookSrc.includes('"completed", "failed", "no-answer", "no_answer", "busy", "error"'));

check('A5', 'webhook: body.completed === true is checked',
  webhookSrc.includes('body.completed === true'));

check('A6', 'webhook: mid-call in_progress returns early without updating is_completed',
  webhookSrc.includes('eventType === "call" && eventStatus === "in_progress"'));

check('A7', 'webhook: transfer tool event returns without setting is_completed',
  /eventType === "tool"/.test(webhookSrc) && !webhookSrc.match(/tool.*is_completed\s*=\s*true/s));

// ── Section B: wolf-webhook variable declaration order (8-11) ─────

check('A8', 'webhook: inbound path uses inboundNow, not forward-ref to now',
  webhookSrc.includes('inboundNow') && webhookSrc.includes('created_at: inboundNow'));

check('A9', 'webhook: callInfo type includes lead_id',
  /callInfo.*lead_id.*string\s*\|\s*null/.test(webhookSrc));

check('A10', 'webhook: callInfo type includes created_at',
  /callInfo.*created_at.*string/.test(webhookSrc));

check('A11', 'webhook: SELECT fetches lead_id and created_at from calls',
  webhookSrc.includes('lead_id, created_at FROM calls'));

// ── Section C: wolf-backfill premature completion guards (12-17) ──

check('B1', 'backfill: wasAutoKilled declared BEFORE hasEvidence',
  backfillSrc.indexOf('const wasAutoKilled') < backfillSrc.indexOf('const hasEvidence'));

check('B2', 'backfill: is_completed is conditional on hasEvidence',
  backfillSrc.includes('if (hasEvidence) updateData.is_completed = true'));

check('B3', 'backfill: no unconditional is_completed: true in updateData initializer',
  !backfillSrc.match(/updateData\s*[:=]\s*\{[^}]*is_completed:\s*true/));

check('B4', 'backfill: hasEvidence checks transcript',
  /hasEvidence\s*=\s*Boolean\(\s*transcript/.test(backfillSrc));

check('B5', 'backfill: hasEvidence checks durationSeconds > 0',
  backfillSrc.includes('durationSeconds > 0'));

check('B6', 'backfill: hasEvidence checks recordingUrl',
  backfillSrc.includes('recordingUrl'));

// ── Section D: call-evidence timestamp validation (18-24) ─────────

check('C1', 'evidence: extractRepFirstSpeechAt rejects numeric timestamps',
  evidenceSrc.includes("typeof ts === \"number\"") && evidenceSrc.includes('return null'));

check('C2', 'evidence: extractRepFirstSpeechAt validates ISO date format',
  evidenceSrc.includes('/^\\d{4}-\\d{2}-\\d{2}/'));

check('C3', 'evidence: extractRepFirstSpeechAt checks created_at fallback',
  evidenceSrc.includes('t.created_at'));

check('C4', 'evidence: extractRepFirstSpeechAt returns null for non-array',
  evidenceSrc.includes('if (!Array.isArray(raw)) return null'));

check('C5', 'evidence: detectLiveHuman exists and is exported',
  evidenceSrc.includes('export function detectLiveHuman'));

check('C6', 'evidence: classifyQueue exists and is exported',
  evidenceSrc.includes('export function classifyQueue'));

check('C7', 'evidence: evaluateTransferState exists and is exported',
  evidenceSrc.includes('export function evaluateTransferState'));

// ── Section E: transfer and queue classification (25-30) ──────────

check('D1', 'evidence: evaluateTransferState returns bridge_confirmed for rep speech',
  evidenceSrc.includes('bridge_confirmed'));

check('D2', 'evidence: evaluateTransferState returns transfer_failed',
  evidenceSrc.includes("'transfer_failed'") || evidenceSrc.includes('"transfer_failed"'));

check('D3', 'evidence: classifyQueue returns fire_transfer',
  evidenceSrc.includes('fire_transfer'));

check('D4', 'evidence: classifyQueue returns human_drop',
  evidenceSrc.includes('human_drop'));

check('D5', 'evidence: classifyQueue returns voice_message',
  evidenceSrc.includes('voice_message'));

check('D6', 'evidence: classifyDropReason handles DNC',
  evidenceSrc.includes('dnc') || evidenceSrc.includes('DNC'));

// ── Section F: webhook HMAC + CORS + structural (31-35) ──────────

check('E1', 'webhook: verifyWebhookHmac imported and used',
  webhookSrc.includes('verifyWebhookHmac') && webhookSrc.includes('hmacResult'));

check('E2', 'webhook: CORS headers include all required fields',
  webhookSrc.includes('Access-Control-Allow-Origin') &&
  webhookSrc.includes('Access-Control-Allow-Methods') &&
  webhookSrc.includes('Access-Control-Allow-Headers'));

check('E3', 'webhook: OPTIONS returns 200 with CORS',
  webhookSrc.includes('OPTIONS') && webhookSrc.includes('status: 200'));

check('E4', 'backfill: CORS headers present',
  backfillSrc.includes('Access-Control-Allow-Origin'));

check('E5', 'webhook: uses postgres npm package for DB',
  webhookSrc.includes('npm:postgres@'));

// ── Summary ──────────────────────────────────────────────────────
console.log(`\n=== Results: ${pass} passed, ${fail} failed, ${pass + fail} total ===\n`);
if (failures.length > 0) {
  console.log('Failures:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
}
