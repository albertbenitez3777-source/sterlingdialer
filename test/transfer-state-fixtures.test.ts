/**
 * Transfer-state fixture tests — no real calls are placed.
 * Verifies the representative-speech predicate for bridge confirmation
 * in both wolf-backfill and wolf-webhook logic.
 */

import { describe, it, expect } from 'vitest';

// ── Extracted predicates (mirror the edge function logic) ───────────────

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

type TransferState =
  | "none"
  | "transfer_api_accepted"
  | "destination_ringing"
  | "transfer_failed"
  | "bridge_ended";

function evaluateTransferState(body: Record<string, unknown>): TransferState {
  const ts = String(body.transfer_status || "").toLowerCase();
  const transferObj = body.transfer as Record<string, unknown> | undefined;
  const callStatus = String(body.status || "").toLowerCase();

  if (ts === "unsuccessful" || ts === "failed") return "transfer_failed";
  if (transferObj?.status && ["failed", "unsuccessful"].includes(String(transferObj.status).toLowerCase())) return "transfer_failed";
  if (["no_answer", "no-answer", "timed_out", "timed-out", "failed", "cancelled", "canceled"].includes(callStatus)) return "transfer_failed";

  if (hasRepresentativeSpeech(body.post_transfer_transcript)) return "bridge_ended";

  const warmTransferState = String(body.warm_transfer_state || body.transfer_state || "").toUpperCase();
  if (warmTransferState === "MERGED") return "bridge_ended";

  if (body.transferred_to && String(body.transferred_to).trim()) return "destination_ringing";
  if (body.transferred_at) return "destination_ringing";

  if (ts === "transferring" || ts === "ringing") return "destination_ringing";
  if (transferObj?.status && ["ringing", "transferring"].includes(String(transferObj.status).toLowerCase())) return "destination_ringing";

  if (ts === "requested" || ts === "accepted" || body.transfer_requested === true) return "transfer_api_accepted";
  if (transferObj?.status && ["requested", "accepted"].includes(String(transferObj.status).toLowerCase())) return "transfer_api_accepted";

  const transcriptRaw = body.transcripts || body.concatenated_transcript || body.transcript;
  const transcriptStr = typeof transcriptRaw === "string" ? transcriptRaw :
    Array.isArray(transcriptRaw) ? transcriptRaw.map((t: Record<string, unknown>) => String(t.text || t.content || "")).join(" ") : "";
  const transcriptLower = transcriptStr.toLowerCase();

  if (transcriptLower.includes("agent-action: transferring to:") || transcriptLower.includes("transferring to: +")) {
    return "transfer_api_accepted";
  }
  if (transcriptLower.includes("connecting you now")) return "transfer_api_accepted";

  return "none";
}

function isBridgeConfirmed(d: Record<string, unknown>): boolean {
  if (hasRepresentativeSpeech(d.post_transfer_transcript)) return true;
  const warmState = String(d.warm_transfer_state || d.transfer_state || "").toUpperCase();
  if (warmState === "MERGED") return true;
  return false;
}

// ── Fixtures ────────────────────────────────────────────────────────────

describe('Transfer-State Fixture Tests', () => {

  describe('[1] transferred_to only => destination_ringing, not bridge_ended', () => {
    it('transferState is destination_ringing', () => {
      const state = evaluateTransferState({ transferred_to: "+15551234567" });
      expect(state).toBe("destination_ringing");
    });
    it('isBridgeConfirmed is false', () => {
      expect(isBridgeConfirmed({ transferred_to: "+15551234567" })).toBe(false);
    });
  });

  describe('[2] transferred_at only => destination_ringing, not bridge_ended', () => {
    it('transferState is destination_ringing', () => {
      const state = evaluateTransferState({ transferred_at: "2026-09-01T12:00:00Z" });
      expect(state).toBe("destination_ringing");
    });
    it('isBridgeConfirmed is false', () => {
      expect(isBridgeConfirmed({ transferred_at: "2026-09-01T12:00:00Z" })).toBe(false);
    });
  });

  describe('[3] user-only post-transfer speech => not bridge_ended', () => {
    const userOnlyTranscript = [
      { speaker_label: "user", text: "Hello, who is this?" },
      { speaker_label: "user", text: "I don't understand what this is about." },
    ];
    it('transferState is NOT bridge_ended', () => {
      const state = evaluateTransferState({ post_transfer_transcript: userOnlyTranscript });
      expect(state).not.toBe("bridge_ended");
    });
    it('isBridgeConfirmed is false', () => {
      expect(isBridgeConfirmed({ post_transfer_transcript: userOnlyTranscript })).toBe(false);
    });
  });

  describe('[4] representative speech => bridge_ended, bridge confirmed', () => {
    const repTranscript = [
      { speaker_label: "user", text: "Hello?" },
      { speaker_label: "representative", text: "Hi, this is John McCarth. I received a transfer about your case." },
    ];
    it('transferState is bridge_ended', () => {
      const state = evaluateTransferState({ post_transfer_transcript: repTranscript });
      expect(state).toBe("bridge_ended");
    });
    it('isBridgeConfirmed is true', () => {
      expect(isBridgeConfirmed({ post_transfer_transcript: repTranscript })).toBe(true);
    });
  });

  describe('[4b] speaker=2 (numeric) => bridge confirmed', () => {
    const repTranscript = [
      { speaker: 1, text: "Hello?" },
      { speaker: 2, text: "Hi, this is Mark. I'm calling about your case." },
    ];
    it('transferState is bridge_ended', () => {
      const state = evaluateTransferState({ post_transfer_transcript: repTranscript });
      expect(state).toBe("bridge_ended");
    });
    it('isBridgeConfirmed is true', () => {
      expect(isBridgeConfirmed({ post_transfer_transcript: repTranscript })).toBe(true);
    });
  });

  describe('[4c] speaker="2" (string) => bridge confirmed', () => {
    const repTranscript = [
      { speaker: "1", text: "Hello?" },
      { speaker: "2", text: "Hi, this is John. I received a transfer about your case." },
    ];
    it('transferState is bridge_ended', () => {
      const state = evaluateTransferState({ post_transfer_transcript: repTranscript });
      expect(state).toBe("bridge_ended");
    });
    it('isBridgeConfirmed is true', () => {
      expect(isBridgeConfirmed({ post_transfer_transcript: repTranscript })).toBe(true);
    });
  });

  describe('[4d] assistant speaker_label => NOT bridge confirmed', () => {
    const assistantTranscript = [
      { speaker_label: "user", text: "Hello?" },
      { speaker_label: "assistant", text: "Hi, I'm calling about your case." },
    ];
    it('transferState is NOT bridge_ended', () => {
      const state = evaluateTransferState({ post_transfer_transcript: assistantTranscript });
      expect(state).not.toBe("bridge_ended");
    });
    it('isBridgeConfirmed is false', () => {
      expect(isBridgeConfirmed({ post_transfer_transcript: assistantTranscript })).toBe(false);
    });
  });

  describe('[4e] agent speaker_label => NOT bridge confirmed', () => {
    const agentTranscript = [
      { speaker_label: "user", text: "Hello?" },
      { speaker_label: "agent", text: "Hi, I'm calling about your case." },
    ];
    it('transferState is NOT bridge_ended', () => {
      const state = evaluateTransferState({ post_transfer_transcript: agentTranscript });
      expect(state).not.toBe("bridge_ended");
    });
    it('isBridgeConfirmed is false', () => {
      expect(isBridgeConfirmed({ post_transfer_transcript: agentTranscript })).toBe(false);
    });
  });

  describe('[4f] unstructured assistant string => NOT bridge confirmed', () => {
    const unstructured = "User: Hello?\nAssistant: Hi, I'm calling about your case.";
    it('transferState is NOT bridge_ended', () => {
      const state = evaluateTransferState({ post_transfer_transcript: unstructured });
      expect(state).not.toBe("bridge_ended");
    });
    it('isBridgeConfirmed is false', () => {
      expect(isBridgeConfirmed({ post_transfer_transcript: unstructured })).toBe(false);
    });
  });

  describe('[4g] user speaker=1 => NOT bridge confirmed', () => {
    const userTranscript = [
      { speaker: 1, text: "Hello? Who is this?" },
      { speaker: 1, text: "I don't understand." },
    ];
    it('transferState is NOT bridge_ended', () => {
      const state = evaluateTransferState({ post_transfer_transcript: userTranscript });
      expect(state).not.toBe("bridge_ended");
    });
    it('isBridgeConfirmed is false', () => {
      expect(isBridgeConfirmed({ post_transfer_transcript: userTranscript })).toBe(false);
    });
  });

  describe('[5] warm-transfer MERGED => bridge_ended, bridge confirmed', () => {
    it('transferState is bridge_ended', () => {
      const state = evaluateTransferState({ warm_transfer_state: "MERGED" });
      expect(state).toBe("bridge_ended");
    });
    it('isBridgeConfirmed is true', () => {
      expect(isBridgeConfirmed({ warm_transfer_state: "MERGED" })).toBe(true);
    });
  });

  describe('[6] warm-transfer NO_ANSWER => transfer_failed, NOT bridge_ended', () => {
    it('transferState is transfer_failed', () => {
      const state = evaluateTransferState({ status: "no_answer", warm_transfer_state: "NO_ANSWER" });
      expect(state).toBe("transfer_failed");
    });
    it('isBridgeConfirmed is false', () => {
      expect(isBridgeConfirmed({ status: "no_answer", warm_transfer_state: "NO_ANSWER" })).toBe(false);
    });
  });

  it('[6b] warm-transfer TIMED_OUT => transfer_failed', () => {
    const state = evaluateTransferState({ status: "timed_out" });
    expect(state).toBe("transfer_failed");
  });

  it('[6c] warm-transfer FAILED => transfer_failed', () => {
    const state = evaluateTransferState({ status: "failed" });
    expect(state).toBe("transfer_failed");
  });

  it('[6d] warm-transfer CANCELLED => transfer_failed', () => {
    const state = evaluateTransferState({ status: "cancelled" });
    expect(state).toBe("transfer_failed");
  });

  describe('[7] transferred_to + transferred_at => destination_ringing', () => {
    it('transferState is destination_ringing', () => {
      const state = evaluateTransferState({
        transferred_to: "+15551234567",
        transferred_at: "2026-09-01T12:00:00Z",
      });
      expect(state).toBe("destination_ringing");
    });
    it('isBridgeConfirmed is false', () => {
      expect(isBridgeConfirmed({
        transferred_to: "+15551234567",
        transferred_at: "2026-09-01T12:00:00Z",
      })).toBe(false);
    });
  });

  it('[8] empty post_transfer_transcript => none', () => {
    const state = evaluateTransferState({ post_transfer_transcript: "" });
    expect(state).toBe("none");
  });

  describe('[9] plain string without speaker labels => NOT bridge_ended', () => {
    it('transferState is NOT bridge_ended', () => {
      const state = evaluateTransferState({ post_transfer_transcript: "Hello, can you hear me?" });
      expect(state).not.toBe("bridge_ended");
    });
    it('isBridgeConfirmed is false', () => {
      expect(isBridgeConfirmed({ post_transfer_transcript: "Hello, can you hear me?" })).toBe(false);
    });
  });

  describe('[10] transfer_status=completed without rep speech => NOT bridge_ended', () => {
    it('transferState is NOT bridge_ended (status string alone is insufficient)', () => {
      const state = evaluateTransferState({ transfer_status: "completed" });
      expect(state).not.toBe("bridge_ended");
    });
    it('isBridgeConfirmed is false', () => {
      expect(isBridgeConfirmed({ transfer_status: "completed" })).toBe(false);
    });
  });

  it('[11] transfer_successful=true without rep speech => NOT bridge_ended', () => {
    const state = evaluateTransferState({ transfer_successful: true });
    expect(state).not.toBe("bridge_ended");
  });
});
