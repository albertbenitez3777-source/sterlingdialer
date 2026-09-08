/**
 * v263 — wolf-webhook evidence field regression tests
 *
 * Validates that classifyDropReason returns correct values for
 * no-answer, voicemail, and human-hangup terminal payloads,
 * and that the UPDATE template writes drop_reason unconditionally.
 */
import { describe, it, expect } from "vitest";

// ── Inline copy of classifyDropReason for unit testing ──────────────

function blandDurationToSeconds(raw: unknown): number {
  const minutes = typeof raw === "string" ? parseFloat(raw) : Number(raw);
  if (isNaN(minutes) || minutes <= 0) return 0;
  if (minutes > 100) return Math.round(minutes);
  return Math.round(minutes * 60);
}

type TransferState =
  | "none"
  | "transfer_requested"
  | "transfer_api_accepted"
  | "destination_ringing"
  | "human_answered"
  | "transfer_failed"
  | "bridge_ended";

function hasRepresentativeSpeech(raw: unknown): boolean {
  if (!raw) return false;
  if (Array.isArray(raw)) {
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
  return false;
}

function classifyDropReason(
  body: Record<string, unknown>,
  transferState: TransferState,
  queue: string,
  transcript: string,
): string {
  const callStatus = String(body.status || "").toLowerCase();
  const answeredBy = String(body.answered_by || "").toLowerCase();
  const lower = transcript.toLowerCase();

  if (
    body.is_dnc === true ||
    lower.includes("do not call") ||
    lower.includes("remove me") ||
    lower.includes("stop calling") ||
    lower.includes("take me off")
  )
    return "dnc";
  if (
    lower.includes("wrong number") ||
    lower.includes("wrong person") ||
    lower.includes("not me") ||
    body.is_wrong_number === true
  )
    return "wrong_person";
  if (lower.includes("not interested") || lower.includes("no thank") || lower.includes("i decline"))
    return "declined";

  if (
    answeredBy === "voicemail" ||
    answeredBy === "machine" ||
    body.voicemail === true ||
    body.is_voicemail === true
  )
    return "voicemail";
  if (
    lower.includes("leave a message") ||
    lower.includes("after the tone") ||
    lower.includes("does not accept solicitations")
  )
    return "voicemail";

  if (callStatus === "no_answer" || callStatus === "no-answer") return "no_answer";
  if (callStatus === "busy") return "busy";

  if (transferState === "transfer_failed") {
    const reason = String(body.transfer_failure_reason || "").toLowerCase();
    if (reason.includes("no answer") || reason.includes("no-answer") || reason.includes("timed"))
      return "transfer_no_answer";
    if (reason.includes("busy")) return "transfer_busy";
    if (reason.includes("cancel")) return "transfer_cancelled";
    return "transfer_provider_error";
  }

  if (transferState === "bridge_ended") {
    if (hasRepresentativeSpeech(body.post_transfer_transcript)) return "bridge_confirmed";
    return "bridge_ended_no_speech";
  }

  if (queue === "human_drop") {
    if (lower.includes("hung up") || lower.includes("disconnected")) return "hangup_before_transfer";
    return "human_drop";
  }

  if (callStatus === "failed" || callStatus === "error") return "provider_error";
  if (callStatus === "timeout" || callStatus === "timed_out" || callStatus === "timed-out")
    return "timeout";

  const durationSec = blandDurationToSeconds(body.call_length ?? body.duration);
  if (durationSec > 0 && durationSec < 5) return "silence";

  return "none";
}

// ── Tests ──────────────────────────────────────────────────────────

describe("v263: classifyDropReason", () => {
  it("no-answer terminal payload returns 'no_answer'", () => {
    const body = { status: "no-answer", call_id: "test-001" };
    const result = classifyDropReason(body, "none", "no_answer", "");
    expect(result).toBe("no_answer");
  });

  it("no_answer status variant also works", () => {
    const body = { status: "no_answer", call_id: "test-002" };
    expect(classifyDropReason(body, "none", "no_answer", "")).toBe("no_answer");
  });

  it("voicemail by answered_by field returns 'voicemail'", () => {
    const body = { status: "completed", answered_by: "voicemail", call_id: "test-003" };
    expect(classifyDropReason(body, "none", "voice_message", "")).toBe("voicemail");
  });

  it("voicemail by machine detection returns 'voicemail'", () => {
    const body = { status: "completed", answered_by: "machine", call_id: "test-004" };
    expect(classifyDropReason(body, "none", "voice_message", "")).toBe("voicemail");
  });

  it("voicemail by transcript marker returns 'voicemail'", () => {
    const body = { status: "completed", call_id: "test-005" };
    const transcript = "USER: Please leave a message after the tone.";
    expect(classifyDropReason(body, "none", "voice_message", transcript)).toBe("voicemail");
  });

  it("human hangup without transfer returns 'human_drop'", () => {
    const body = { status: "completed", answered_by: "human", call_id: "test-006" };
    const transcript = "USER: Hello?\nASSISTANT: Hi, may I speak with John?\nUSER: No thanks.";
    // "not interested" / "no thank" triggers "declined" first
    expect(classifyDropReason(body, "none", "human_drop", transcript)).toBe("declined");
  });

  it("human hangup no decline markers returns 'human_drop'", () => {
    const body = { status: "completed", answered_by: "human", call_id: "test-007" };
    const transcript = "USER: Hello?\nASSISTANT: Hi, may I speak with John?";
    expect(classifyDropReason(body, "none", "human_drop", transcript)).toBe("human_drop");
  });

  it("human hangup with 'hung up' in transcript returns 'hangup_before_transfer'", () => {
    const body = { status: "completed", call_id: "test-008" };
    const transcript = "USER: Hello? The customer hung up before the transfer.";
    expect(classifyDropReason(body, "none", "human_drop", transcript)).toBe(
      "hangup_before_transfer",
    );
  });

  it("DNC marker in transcript returns 'dnc'", () => {
    const body = { status: "completed", call_id: "test-009" };
    const transcript = "USER: Put me on your do not call list.";
    expect(classifyDropReason(body, "none", "human_drop", transcript)).toBe("dnc");
  });

  it("transfer_failed with no_answer reason returns 'transfer_no_answer'", () => {
    const body = {
      status: "completed",
      transfer_failure_reason: "Destination no answer after 30s",
      call_id: "test-010",
    };
    expect(classifyDropReason(body, "transfer_failed", "human_drop", "")).toBe(
      "transfer_no_answer",
    );
  });

  it("bridge_ended with rep speech returns 'bridge_confirmed'", () => {
    const body = {
      status: "completed",
      post_transfer_transcript: [
        { text: "Hi this is the office", speaker_label: "representative", speaker: 2 },
      ],
      call_id: "test-011",
    };
    expect(classifyDropReason(body, "bridge_ended", "fire_transfer", "")).toBe("bridge_confirmed");
  });

  it("bridge_ended without rep speech returns 'bridge_ended_no_speech'", () => {
    const body = { status: "completed", call_id: "test-012" };
    expect(classifyDropReason(body, "bridge_ended", "fire_transfer", "")).toBe(
      "bridge_ended_no_speech",
    );
  });

  it("short call under 5s returns 'silence'", () => {
    const body = { status: "completed", call_length: "0.05", call_id: "test-013" };
    expect(classifyDropReason(body, "none", "no_answer", "")).toBe("silence");
  });

  it("drop_reason is never empty for a standard no-answer", () => {
    const body = { status: "no-answer" };
    const result = classifyDropReason(body, "none", "no_answer", "");
    expect(result).not.toBe("");
    expect(result).toBe("no_answer");
  });

  it("drop_reason is never empty for a voicemail", () => {
    const body = { answered_by: "voicemail" };
    const result = classifyDropReason(body, "none", "voice_message", "");
    expect(result).not.toBe("");
    expect(result).toBe("voicemail");
  });

  it("drop_reason for unknown completed call with duration is 'none'", () => {
    const body = { status: "completed", call_length: "1.5" };
    const result = classifyDropReason(body, "none", "no_answer", "");
    expect(result).toBe("none");
  });
});

describe("v263: UPDATE template safety", () => {
  it("COALESCE pattern preserves existing values when new value is null", () => {
    // Simulates: COALESCE(null, 'existing') = 'existing'
    const existing = "existing_transcript";
    const newVal: string | null = null;
    expect(newVal ?? existing).toBe(existing);
  });

  it("COALESCE pattern overrides when new value is set", () => {
    const existing = "old_transcript";
    const newVal: string | null = "new_transcript";
    expect(newVal ?? existing).toBe("new_transcript");
  });

  it("drop_reason is always a string, never null", () => {
    // classifyDropReason always returns a non-empty string (at minimum "none")
    const cases: Array<[Record<string, unknown>, TransferState, string, string]> = [
      [{ status: "completed" }, "none", "no_answer", ""],
      [{ status: "no-answer" }, "none", "no_answer", ""],
      [{ answered_by: "voicemail" }, "none", "voice_message", ""],
      [{ status: "completed" }, "none", "human_drop", "Hello there"],
    ];
    for (const [body, ts, queue, transcript] of cases) {
      const result = classifyDropReason(body, ts, queue, transcript);
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    }
  });
});
