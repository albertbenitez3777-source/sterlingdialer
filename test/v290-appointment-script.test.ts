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

describe("appointment-script", () => {
  const agentName = "James Spencer";
  const consumerName = "John Smith";
  const bookingUrl = "https://example.supabase.co/functions/v1/wolf-callback-booking";

  describe("buildBookingTool", () => {
    it("creates a tool with the correct URL", () => {
      const tool = buildBookingTool(bookingUrl);
      expect(tool.name).toBe("book_callback");
      expect(tool.url).toBe(bookingUrl);
      expect(tool.method).toBe("POST");
      expect(tool.parameters.properties.consent).toBeDefined();
      expect(tool.parameters.properties.preferred_window).toBeDefined();
      expect(tool.parameters.required).toContain("consent");
    });
  });

  describe("buildAppointmentTask", () => {
    it("does NOT mention transfer_phone_number or transfer tool", () => {
      const task = buildAppointmentTask(agentName, consumerName);
      expect(task).not.toContain("transfer_phone_number");
      expect(task).not.toContain("configured transfer tool");
      expect(task).toContain("book_callback");
      expect(task).toContain("Federal One");
      expect(task).toContain("Elizabeth Sterling");
    });

    it("does NOT mention PCH to third parties or before identity", () => {
      const task = buildAppointmentTask(agentName, consumerName);
      expect(task).toContain("Do NOT mention PCH");
      expect(task).toContain("third party");
      expect(task).toContain("unverified");
    });

    it("does NOT invent amounts or deadlines", () => {
      const task = buildAppointmentTask(agentName, consumerName);
      expect(task).toContain("Do NOT invent an amount");
      expect(task).toContain("lawsuit");
      expect(task).toContain("deadline");
    });

    it("handles no-slot case as a request, not an appointment", () => {
      const task = buildAppointmentTask(agentName, consumerName);
      expect(task).toContain("don't have an available slot");
      expect(task).toContain("request");
      expect(task.toLowerCase()).toContain("do not promise a time");
    });

    it("requires consent before booking", () => {
      const task = buildAppointmentTask(agentName, consumerName);
      expect(task).toContain("explicit agreement");
      expect(task).toContain("consent");
    });

    it("does NOT ask 'Are you still there?' of recordings", () => {
      const task = buildAppointmentTask(agentName, consumerName);
      expect(task).toContain("NOT ask \"Are you still there?\" of a recognized recording");
    });
  });

  describe("buildTransferTask", () => {
    it("mentions transfer and PCH after identity", () => {
      const task = buildTransferTask(agentName, consumerName);
      expect(task).toContain("transfer tool");
      expect(task).toContain("PCH");
      expect(task).toContain("Federal One");
    });
  });

  describe("buildCallScript — appointment mode", () => {
    it("returns tools and no transfer_phone_number", () => {
      const script = buildCallScript({
        agentName,
        consumerName,
        mode: "appointment",
        bookingToolUrl: bookingUrl,
      });
      expect(script.tools).toBeDefined();
      expect(script.tools).toHaveLength(1);
      expect(script.transfer_phone_number).toBeUndefined();
      expect(script.task).toContain("book_callback");
      expect(script.first_sentence).toContain(consumerName);
    });
  });

  describe("buildCallScript — transfer mode", () => {
    it("returns no tools and no transfer_phone_number (caller adds it)", () => {
      const script = buildCallScript({
        agentName,
        consumerName,
        mode: "transfer",
      });
      expect(script.tools).toBeUndefined();
      expect(script.transfer_phone_number).toBeUndefined();
      expect(script.task).toContain("transfer tool");
    });
  });

  describe("appointmentFirstSentence", () => {
    it("includes the consumer name", () => {
      const greeting = appointmentFirstSentence(consumerName);
      expect(greeting).toContain(consumerName);
      expect(greeting).toContain("Hello");
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
