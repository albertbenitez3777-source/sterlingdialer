import { describe, it, expect } from "vitest";
import {
  buildCallScript,
  buildAppointmentTask,
  buildTransferTask,
  buildBookingTool,
  appointmentFirstSentence,
  appointmentInboundGreeting,
  type CallMode,
} from "../supabase/functions/_shared/appointment-script.ts";

describe("appointment-script — v291 fixes", () => {
  const agentName = "James Spencer";
  const consumerName = "John Smith";
  const bookingUrl = "https://example.supabase.co/functions/v1/wolf-callback-booking";

  describe("buildBookingTool", () => {
    it("creates a tool with the correct URL and required consent", () => {
      const tool = buildBookingTool(bookingUrl);
      expect(tool.name).toBe("book_callback");
      expect(tool.url).toBe(bookingUrl);
      expect(tool.parameters.properties.consent).toBeDefined();
      expect(tool.parameters.required).toContain("consent");
    });
  });

  describe("buildAppointmentTask — FDCPA and no 'officer'", () => {
    const task = buildAppointmentTask(agentName, consumerName);

    it("instructs NOT to use the word 'officer'", () => {
      expect(task.toLowerCase()).toContain("do not call");
      expect(task).toContain("\"officer\"");
    });

    it("does NOT mention transfer_phone_number or transfer tool", () => {
      expect(task).not.toContain("transfer_phone_number");
      expect(task).not.toContain("configured transfer tool");
    });

    it("includes the FDCPA debt-collector disclosure", () => {
      expect(task).toContain("attempt to collect a debt");
      expect(task).toContain("debt collector");
    });

    it("does NOT mention PCH to third parties or before identity", () => {
      expect(task).toContain("Do NOT mention PCH");
      expect(task).toContain("third party");
    });

    it("does NOT invent amounts or deadlines", () => {
      expect(task).toContain("Do NOT invent an amount");
      expect(task).toContain("lawsuit");
      expect(task).toContain("deadline");
    });

    it("does NOT imply government or legal authority", () => {
      expect(task).toContain("imply government or legal authority");
    });

    it("uses 'representative' not 'officer'", () => {
      expect(task).toContain("assigned representative");
    });

    it("handles no-slot case as a request, not an appointment", () => {
      expect(task).toContain("don't have an available slot");
      expect(task).toContain("request");
      expect(task.toLowerCase()).toContain("do not promise a time");
    });

    it("requires explicit consent, not maybe", () => {
      expect(task).toContain("explicit agreement");
      expect(task).toContain('"maybe"');
    });

    it("does NOT ask 'Are you still there?' of recordings", () => {
      expect(task).toContain("NOT ask \"Are you still there?\" of a recognized recording");
    });

    it("includes DNC handling", () => {
      expect(task).toContain("do not call");
      expect(task).toContain("stop calling");
    });
  });

  describe("buildTransferTask — FDCPA and no 'officer'", () => {
    const task = buildTransferTask(agentName, consumerName);

    it("instructs NOT to use the word 'officer'", () => {
      expect(task.toLowerCase()).toContain("do not call");
      expect(task).toContain("\"officer\"");
    });

    it("includes the FDCPA debt-collector disclosure", () => {
      expect(task).toContain("attempt to collect a debt");
      expect(task).toContain("debt collector");
    });

    it("uses 'representative' not 'officer'", () => {
      expect(task).toContain("assigned representative");
    });
  });

  describe("buildCallScript — appointment mode", () => {
    it("returns tools and no transfer_phone_number", () => {
      const script = buildCallScript({
        agentName, consumerName, mode: "appointment", bookingToolUrl: bookingUrl,
      });
      expect(script.tools).toBeDefined();
      expect(script.tools).toHaveLength(1);
      expect(script.transfer_phone_number).toBeUndefined();
      expect(script.task).toContain("book_callback");
    });
  });

  describe("buildCallScript — transfer mode", () => {
    it("returns no tools and no transfer_phone_number (caller adds it)", () => {
      const script = buildCallScript({
        agentName, consumerName, mode: "transfer",
      });
      expect(script.tools).toBeUndefined();
      expect(script.transfer_phone_number).toBeUndefined();
      expect(script.task).toContain("transfer tool");
    });
  });

  describe("appointmentInboundGreeting", () => {
    it("includes Elizabeth Sterling and Federal One", () => {
      const greeting = appointmentInboundGreeting(agentName);
      expect(greeting).toContain("Elizabeth Sterling");
      expect(greeting).toContain("Federal One");
      expect(greeting).toContain(agentName);
    });
  });
});
