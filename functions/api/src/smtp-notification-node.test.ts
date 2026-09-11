import { describe, expect, it, vi } from "vitest";
import nodemailer from "nodemailer";

import { createNodeSmtpNotificationSender } from "./smtp-notification-node";

describe("Node SMTP notification composition", () => {
  it("BDD-MAIL-024 creates an authenticated transport after trusted parsing", () => {
    const createTransport = vi
      .spyOn(nodemailer, "createTransport")
      .mockReturnValue({ sendMail: vi.fn() } as never);
    const sender = createNodeSmtpNotificationSender(
      {
        host: "smtp.example.com",
        port: 465,
        secure: true,
        user: "production-user",
        password: "production-password",
        from: "Y7 Feedback <no-reply@y7labs.com>",
      },
      { resolve: vi.fn() },
    );
    expect(createTransport).toHaveBeenCalledWith({
      auth: { user: "production-user", pass: "production-password" },
      host: "smtp.example.com",
      port: 465,
      secure: true,
    });
    expect(sender).toBeDefined();
    createTransport.mockRestore();
  });
});
