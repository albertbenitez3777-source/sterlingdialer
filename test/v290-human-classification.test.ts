import { describe, it, expect } from "vitest";
import {
  detectLiveHuman,
  detectDncFromTranscript,
  isOriginalVoicemail,
  classifyQueue,
  evaluateTransferState,
} from "../supabase/functions/_shared/call-evidence.ts";

describe("detectLiveHuman — improved machine detection", () => {
  it("returns false for voicemail greeting transcripts", () => {
    const transcript = "USER: Please leave a message after the tone.";
    expect(detectLiveHuman({}, transcript)).toBe(false);
  });

  it("returns false for mailbox menu transcripts", () => {
    const transcript = "USER: To send your message press pound. To mark the message press star.";
    expect(detectLiveHuman({}, transcript)).toBe(false);
  });

  it("returns false for screening bot that repeats back", () => {
    const transcript = "ASSISTANT: Hello, am I speaking with John?\nUSER: hello am i speaking with john";
    expect(detectLiveHuman({}, transcript)).toBe(false);
  });

  it("returns false for 'not accept solicitations' message", () => {
    const transcript = "USER: This number does not accept solicitations.";
    expect(detectLiveHuman({}, transcript)).toBe(false);
  });

  it("returns false for remote access code prompt", () => {
    const transcript = "USER: Please enter your remote access code.";
    expect(detectLiveHuman({}, transcript)).toBe(false);
  });

  it("returns false for directory/extension prompt", () => {
    const transcript = "USER: For English press one. Para Espanol oprima dos. Dial by name using the directory.";
    expect(detectLiveHuman({}, transcript)).toBe(false);
  });

  it("returns true for a conversational response", () => {
    const transcript = "ASSISTANT: Hello, am I speaking with John?\nUSER: Yes, speaking.";
    expect(detectLiveHuman({}, transcript)).toBe(true);
  });

  it("returns true for 'this is' identity confirmation", () => {
    const transcript = "ASSISTANT: Hello, am I speaking with John?\nUSER: This is John.";
    expect(detectLiveHuman({}, transcript)).toBe(true);
  });

  it("returns true for wrong number report (human)", () => {
    const transcript = "ASSISTANT: Hello, am I speaking with John?\nUSER: Wrong number, I don't know any John.";
    expect(detectLiveHuman({}, transcript)).toBe(true);
  });

  it("returns false for answered_by=voicemail regardless of transcript", () => {
    expect(detectLiveHuman({ answered_by: "voicemail" }, "USER: Hello")).toBe(false);
  });

  it("returns true for answered_by=human regardless of transcript", () => {
    expect(detectLiveHuman({ answered_by: "human" }, "")).toBe(true);
  });

  it("returns false for empty transcript", () => {
    expect(detectLiveHuman({}, "")).toBe(false);
  });

  it("returns false for only assistant speech (no user)", () => {
    const transcript = "ASSISTANT: Hello, am I speaking with John?\nASSISTANT: Are you still there?";
    expect(detectLiveHuman({}, transcript)).toBe(false);
  });
});

describe("detectDncFromTranscript", () => {
  it("detects 'do not call'", () => {
    expect(detectDncFromTranscript("I said do not call me anymore")).toBe(true);
  });

  it("detects 'stop calling'", () => {
    expect(detectDncFromTranscript("Please stop calling this number")).toBe(true);
  });

  it("detects 'remove me from'", () => {
    expect(detectDncFromTranscript("Remove me from your list")).toBe(true);
  });

  it("detects 'take me off'", () => {
    expect(detectDncFromTranscript("Take me off your call list")).toBe(true);
  });

  it("returns false for casual 'no thank you'", () => {
    expect(detectDncFromTranscript("No thank you, I'm not interested")).toBe(false);
  });

  it("returns false for empty or null", () => {
    expect(detectDncFromTranscript("")).toBe(false);
    expect(detectDncFromTranscript(null as unknown as string)).toBe(false);
  });
});

describe("classifyQueue — machine contacts do not become human callbacks", () => {
  it("classifies voicemail as voice_message, not human_drop", () => {
    const queue = classifyQueue("none", false, true, true);
    expect(queue).toBe("voice_message");
  });

  it("classifies human as human_drop", () => {
    const queue = classifyQueue("none", true, false, false);
    expect(queue).toBe("human_drop");
  });

  it("classifies no-answer as no_answer", () => {
    const queue = classifyQueue("none", false, false, false);
    expect(queue).toBe("no_answer");
  });
});
