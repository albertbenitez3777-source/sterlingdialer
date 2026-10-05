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

describe("appointment-script — v292 Bland tool format", () => {
  const agentName = "James Spencer";
  const consumerName = "John Smith";
  const bookingUrl = "https://example.supabase.co/functions/v1/wolf-callback-booking";
  const authToken = "a".repeat(64);

  describe("buildBookingTool — Bland custom-tool format", () => {
    const tool = buildBookingTool(bookingUrl, authToken);

    it("has the correct URL and method", () => {
      expect(tool.url).toBe(bookingUrl);
      expect(tool.method).toBe("POST");
    });

    it("has headers with Authorization bearer token", () => {
      expect(tool.headers).toBeDefined();
      expect((tool.headers as Record<string, string>).Authorization).toBe(`Bearer ${authToken}`);
      expect((tool.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    });

    it("has body with call_id prompt variable and consent", () => {
      expect(tool.body).toBeDefined();
      const body = tool.body as Record<string, string>;
      expect(body.call_id).toBe("{{call_id}}");
      expect(body.consent).toBe("{{consent}}");
      expect(body.preferred_window).toBe("{{preferred_window}}");
    });

    it("has input_schema with consent required", () => {
      expect(tool.input_schema).toBeDefined();
      const schema = tool.input_schema as Record<string, unknown>;
      expect(schema.properties).toBeDefined();
      expect((schema as Record<string, unknown>).required).toContain("consent");
    });
  });

  describe("buildCallScript — appointment mode with token", () => {
    it("returns tools with booking tool when token provided", () => {
      const script = buildCallScript({
        agentName, consumerName, mode: "appointment",
        bookingToolUrl: bookingUrl, bookingToolToken: authToken,
      });
      expect(script.tools).toBeDefined();
      expect(script.tools).toHaveLength(1);
      expect(script.transfer_phone_number).toBeUndefined();
    });

    it("returns NO tools when token is missing", () => {
      const script = buildCallScript({
        agentName, consumerName, mode: "appointment",
        bookingToolUrl: bookingUrl,
      });
      expect(script.tools).toBeUndefined();
    });
  });

  describe("buildAppointmentTask — FDCPA and no 'officer' title", () => {
    const task = buildAppointmentTask(agentName, consumerName);

    it("instructs NOT to use 'officer'", () => {
      expect(task).toContain('"officer"');
      expect(task.toLowerCase()).toContain("do not call");
    });

    it("includes FDCPA debt-collector disclosure", () => {
      expect(task).toContain("attempt to collect a debt");
      expect(task).toContain("debt collector");
    });

    it("uses 'representative' not 'officer' as title", () => {
      expect(task).toContain("assigned representative");
    });

    it("includes book_callback tool instruction", () => {
      expect(task).toContain("book_callback");
    });

    it("does NOT mention transfer_phone_number", () => {
      expect(task).not.toContain("transfer_phone_number");
    });
  });

  describe("buildTransferTask — FDCPA and no 'officer' title", () => {
    const task = buildTransferTask(agentName, consumerName);

    it("instructs NOT to use 'officer'", () => {
      expect(task).toContain('"officer"');
    });

    it("includes FDCPA debt-collector disclosure", () => {
      expect(task).toContain("attempt to collect a debt");
      expect(task).toContain("debt collector");
    });
  });
});
