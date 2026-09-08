/**
 * Shared call-evidence helpers used by both wolf-webhook and wolf-backfill.
 * Pure functions — no I/O, no DB, no fetch.
 *
 * Evidence stages are tracked independently:
 *   transfer_requested → destination_dialed → destination_ringing →
 *   human_answered → bridge_confirmed
 * Each requires its own proof; later stages do not imply earlier ones were verified.
 */

// ── Types ───────────────────────────────────────────────────────────

export type TransferState =
  | "none"
  | "transfer_requested"
  | "transfer_api_accepted"
  | "destination_ringing"
  | "destination_voicemail"
  | "human_answered"
  | "bridge_confirmed"
  | "transfer_failed"
  | "conflicting";

export interface EvidenceResult {
  transferState: TransferState;
  isLiveHuman: boolean;
  bridgeConfirmed: boolean;
  talkrouteLegCreated: boolean;
  talkrouteAnswered: boolean;
  destinationDialed: boolean;
  destinationVoicemail: boolean;
  hasRepSpeech: boolean;
  hasMergedState: boolean;
  isVoicemail: boolean;
  queue: string;
  dropReason: string;
}

// ── Transcript helpers ──────────────────────────────────────────────

export function flattenTranscript(raw: unknown, concatenated?: unknown): string {
  if (typeof concatenated === "string" && concatenated.trim()) return concatenated.trim();
  if (!raw) return "";
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((turn: Record<string, unknown>) => {
        const role = String(turn.user || turn.role || turn.speaker || "").toUpperCase();
        const text = String(turn.text || turn.content || turn.message || "");
        return text ? `${role}: ${text}` : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

// ── Duration ────────────────────────────────────────────────────────

export function blandDurationToSeconds(raw: unknown): number {
  const minutes = typeof raw === "string" ? parseFloat(raw) : Number(raw);
  if (isNaN(minutes) || minutes <= 0) return 0;
  if (minutes > 100) return Math.round(minutes);
  return Math.round(minutes * 60);
}

// ── Representative speech detection ─────────────────────────────────

/**
 * Returns true ONLY when post_transfer_transcript contains structured nonempty
 * text from the representative: speaker_label="representative" OR speaker=2/"2".
 * Unstructured strings and caller-only turns do NOT qualify.
 */
export function hasRepresentativeSpeech(raw: unknown): boolean {
  if (!raw || !Array.isArray(raw)) return false;
  return raw.some((turn: Record<string, unknown>) => {
    const text = String(turn.text || turn.content || turn.message || "").trim();
    if (!text) return false;
    const speakerLabel = String(turn.speaker_label || "").toLowerCase();
    const speaker = turn.speaker;
    if (speakerLabel === "representative") return true;
    if (speaker === 2 || speaker === "2") return true;
    return false;
  });
}

/**
 * Extract the timestamp of the first representative speech turn.
 */
export function extractRepFirstSpeechAt(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null;
  for (const turn of raw) {
    const t = turn as Record<string, unknown>;
    const text = String(t.text || t.content || t.message || "").trim();
    if (!text) continue;
    const speakerLabel = String(t.speaker_label || "").toLowerCase();
    const speaker = t.speaker;
    if (speakerLabel === "representative" || speaker === 2 || speaker === "2") {
      const ts = t.timestamp || t.time || t.started_at || t.start || t.created_at;
      if (ts == null) return null;
      // If timestamp is a number (relative seconds), it's not an absolute time
      if (typeof ts === "number") return null;
      const tsStr = String(ts);
      // Validate it looks like an ISO timestamp before returning
      if (/^\d{4}-\d{2}-\d{2}/.test(tsStr)) return tsStr;
      return null;
    }
  }
  return null;
}

// ── Warm-transfer MERGED detection ──────────────────────────────────

/**
 * Check for documented warm_transfer_call.state === "MERGED".
 * Bland's documented field is the nested object warm_transfer_call with a .state property.
 * Also checks legacy flat aliases warm_transfer_state / transfer_state.
 */
export function hasMergedState(body: Record<string, unknown>): boolean {
  // Documented nested field: warm_transfer_call.state
  const warmTransferCall = body.warm_transfer_call as Record<string, unknown> | undefined;
  if (warmTransferCall && typeof warmTransferCall === "object") {
    const state = String(warmTransferCall.state || "").toUpperCase();
    if (state === "MERGED") return true;
  }
  // Legacy flat aliases
  const flatState = String(body.warm_transfer_state || body.transfer_state || "").toUpperCase();
  return flatState === "MERGED";
}

// ── Bridge evidence ─────────────────────────────────────────────────

/**
 * Bridge is confirmed ONLY when:
 * a) post_transfer_transcript has structured nonempty representative speech, OR
 * b) documented warm_transfer_call.state = "MERGED"
 *
 * transferred_to/transferred_at do NOT prove bridge.
 * transfer_status "completed"/"successful" does NOT prove bridge.
 */
export function isBridgeConfirmed(body: Record<string, unknown>): boolean {
  if (hasRepresentativeSpeech(body.post_transfer_transcript)) return true;
  if (hasMergedState(body)) return true;
  return false;
}

// ── Live human detection ────────────────────────────────────────────

export function detectLiveHuman(body: Record<string, unknown>, transcript?: string): boolean {
  const answeredBy = String(body.answered_by || "").toLowerCase();
  if (answeredBy === "voicemail" || answeredBy === "machine") return false;
  if (answeredBy === "human" || body.human_answered === true) return true;
  const direction = String(body.call_type || body.direction || "").toLowerCase();
  if (direction === "inbound") return true;
  if (body.voicemail === true || body.is_voicemail === true) return false;

  // Transcript-based detection for backfill
  if (transcript) {
    const t = transcript.toLowerCase();
    if (t.includes("call ended due to voicemail detection")) return false;
    if (t.includes("leave a message") || t.includes("after the tone") || t.includes("mailbox")) return false;
    const lines = t.split("\n");
    const userLines = lines.filter((line) => line.startsWith("user:") || line.startsWith("human:"));
    return userLines.some(line => line.replace(/^(user|human):\s*/i, "").trim().length > 2);
  }

  return false;
}

// ── Voicemail detection ─────────────────────────────────────────────

export function isOriginalVoicemail(body: Record<string, unknown>, transcript: string): boolean {
  if (body.voicemail === true || body.is_voicemail === true) return true;
  const answeredBy = String(body.answered_by || "").toLowerCase();
  if (answeredBy === "voicemail" || answeredBy === "machine") return true;
  const lower = transcript.toLowerCase();
  const markers = ["leave a message", "after the tone", "press pound", "mailbox",
    "does not accept solicitations", "to send your message", "to mark the message"];
  return markers.some(m => lower.includes(m));
}

// ── Transfer state evaluation ───────────────────────────────────────

/**
 * Evaluates transfer state from Bland webhook/API payload.
 * Tracks stages independently — each requires its own evidence.
 */
export function evaluateTransferState(body: Record<string, unknown>): TransferState {
  const ts = String(body.transfer_status || "").toLowerCase();
  const transferObj = body.transfer as Record<string, unknown> | undefined;
  const callStatus = String(body.status || "").toLowerCase();

  // Explicit failure states
  if (ts === "unsuccessful" || ts === "failed") return "transfer_failed";
  if (transferObj?.status && ["failed", "unsuccessful"].includes(String(transferObj.status).toLowerCase())) return "transfer_failed";
  if (ts && ["no_answer", "no-answer", "timed_out", "timed-out", "failed", "cancelled", "canceled"].includes(callStatus)) return "transfer_failed";

  // Bridge confirmed: representative speech or documented MERGED
  if (isBridgeConfirmed(body)) return "bridge_confirmed";

  // Destination ringing: transferred_to proves dial attempt, NOT answer
  if (body.transferred_to && String(body.transferred_to).trim()) return "destination_ringing";
  if (body.transferred_at) return "destination_ringing";
  if (ts === "transferring" || ts === "ringing") return "destination_ringing";
  if (transferObj?.status && ["ringing", "transferring"].includes(String(transferObj.status).toLowerCase())) return "destination_ringing";

  // Transfer API accepted
  if (ts === "requested" || ts === "accepted" || body.transfer_requested === true) return "transfer_api_accepted";
  if (transferObj?.status && ["requested", "accepted"].includes(String(transferObj.status).toLowerCase())) return "transfer_api_accepted";

  // "completed"/"successful" status does NOT prove bridge — preserve as unknown
  if (ts === "completed" || ts === "successful") {
    return "destination_ringing";
  }

  // Transcript-based transfer detection
  const transcriptRaw = body.transcripts || body.concatenated_transcript || body.transcript;
  const transcriptStr = typeof transcriptRaw === "string" ? transcriptRaw :
    Array.isArray(transcriptRaw) ? transcriptRaw.map((t: Record<string, unknown>) => String(t.text || t.content || "")).join(" ") : "";
  const transcriptLower = transcriptStr.toLowerCase();

  if (transcriptLower.includes("agent-action: transferring to:") || transcriptLower.includes("transferring to: +")) {
    return "transfer_api_accepted";
  }
  if (transcriptLower.includes("connecting you now")) {
    return "transfer_api_accepted";
  }

  return "none";
}

// ── Queue classification ────────────────────────────────────────────

export function classifyQueue(
  transferState: TransferState,
  isLiveHuman: boolean,
  isVoicemail: boolean,
  hasVoicemailMarker: boolean,
): string {
  if (transferState === "bridge_confirmed") {
    return hasVoicemailMarker ? "voice_message" : "fire_transfer";
  }
  if (transferState === "transfer_failed") return "human_drop";
  if ((isVoicemail || hasVoicemailMarker) && !isLiveHuman) return "voice_message";
  if (isLiveHuman) return "human_drop";
  return "no_answer";
}

// ── Drop reason classification ──────────────────────────────────────

export function classifyDropReason(
  body: Record<string, unknown>,
  transferState: TransferState,
  queue: string,
  transcript: string,
): string {
  const callStatus = String(body.status || "").toLowerCase();
  const answeredBy = String(body.answered_by || "").toLowerCase();
  const lower = transcript.toLowerCase();

  if (body.is_dnc === true || lower.includes("do not call") || lower.includes("remove me") || lower.includes("stop calling") || lower.includes("take me off")) return "dnc";
  if (lower.includes("wrong number") || lower.includes("wrong person") || lower.includes("not me") || body.is_wrong_number === true) return "wrong_person";
  if (lower.includes("not interested") || lower.includes("no thank") || lower.includes("i decline")) return "declined";
  if (answeredBy === "voicemail" || answeredBy === "machine" || body.voicemail === true || body.is_voicemail === true) return "voicemail";
  if (lower.includes("leave a message") || lower.includes("after the tone") || lower.includes("does not accept solicitations")) return "voicemail";
  if (callStatus === "no_answer" || callStatus === "no-answer") return "no_answer";
  if (callStatus === "busy") return "busy";

  if (transferState === "transfer_failed") {
    const reason = String(body.transfer_failure_reason || "").toLowerCase();
    if (reason.includes("no answer") || reason.includes("no-answer") || reason.includes("timed")) return "transfer_no_answer";
    if (reason.includes("busy")) return "transfer_busy";
    if (reason.includes("cancel")) return "transfer_cancelled";
    return "transfer_provider_error";
  }

  if (transferState === "bridge_confirmed") {
    if (hasRepresentativeSpeech(body.post_transfer_transcript)) return "bridge_confirmed";
    return "bridge_ended_no_speech";
  }

  if (queue === "human_drop") {
    if (lower.includes("hung up") || lower.includes("disconnected")) return "hangup_before_transfer";
    return "human_drop";
  }

  if (callStatus === "failed" || callStatus === "error") return "provider_error";
  if (callStatus === "timeout" || callStatus === "timed_out" || callStatus === "timed-out") return "timeout";

  const durationSec = blandDurationToSeconds(body.call_length ?? body.duration);
  if (durationSec > 0 && durationSec < 5) return "silence";

  return "none";
}

// ── HMAC-SHA256 webhook signature verification ──────────────────────

/**
 * Verify webhook signature using a dedicated BLAND_WEBHOOK_SECRET.
 * Uses constant-time comparison to prevent timing attacks.
 * Returns true only when both secret and signature are present and match.
 * Missing config is an explicit rejection, NOT a silent bypass.
 */
export function verifyWebhookHmac(
  rawBody: string,
  signatureHeader: string | null,
  secret: string | null,
  createHmacFn: (algorithm: string, key: string) => { update(data: string): { digest(encoding: string): string } },
  timingSafeEqualFn?: (a: Uint8Array, b: Uint8Array) => boolean,
): { valid: boolean; reason: string } {
  if (!secret) return { valid: false, reason: "BLAND_WEBHOOK_SECRET not configured — release blocker" };
  if (!signatureHeader) return { valid: false, reason: "Missing signature header" };

  try {
    const expected = createHmacFn("sha256", secret).update(rawBody).digest("hex");
    const sig = signatureHeader.trim().replace(/^sha256=/, "");

    if (timingSafeEqualFn) {
      const a = new TextEncoder().encode(expected);
      const b = new TextEncoder().encode(sig);
      if (a.length !== b.length) return { valid: false, reason: "Signature length mismatch" };
      const match = timingSafeEqualFn(a, b);
      return match ? { valid: true, reason: "ok" } : { valid: false, reason: "Signature mismatch" };
    }

    // Fallback: constant-time-ish comparison via double HMAC
    const verifyKey = "verify-" + Date.now();
    const h1 = createHmacFn("sha256", verifyKey).update(expected).digest("hex");
    const h2 = createHmacFn("sha256", verifyKey).update(sig).digest("hex");
    return h1 === h2
      ? { valid: true, reason: "ok" }
      : { valid: false, reason: "Signature mismatch" };
  } catch (e) {
    return { valid: false, reason: `Verification error: ${String(e)}` };
  }
}
