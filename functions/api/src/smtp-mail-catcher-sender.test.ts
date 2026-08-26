import { describe, expect, it, vi } from "vitest";
import nodemailer from "nodemailer";

import { createSmtpMailCatcherSender } from "./smtp-mail-catcher-sender";
import {
  createNodeSmtpMailCatcherSender,
  mailCatcherConfigFromEnvironment,
} from "./smtp-mail-catcher-node";

function context(outcome: unknown = { accepted: ["reporter@example.test"] }) {
  const sendMail = vi.fn(() => Promise.resolve(outcome));
  return {
    sendMail,
    sender: createSmtpMailCatcherSender(
      { sendMail },
      {
        from: "Y7 Feedback Preview <no-reply@y7-feedback.test>",
        to: "reporter@example.test",
      },
    ),
  };
}

describe("Preview SMTP mail catcher sender", () => {
  it("BDD-MAIL-001 sends one minimal localized acceptance message", async () => {
    const target = context();

    await expect(
      target.sender.deliver({
        deliveryId: "notification_1",
        channel: "email",
        payload: {
          kind: "feedback_accepted",
          locale: "fr",
          reference: "Y7-REF-12345678",
        },
      }),
    ).resolves.toBe("delivered");

    expect(target.sendMail).toHaveBeenCalledOnce();
    expect(target.sendMail).toHaveBeenCalledWith({
      envelope: {
        from: "no-reply@y7-feedback.test",
        to: "reporter@example.test",
      },
      from: "Y7 Feedback Preview <no-reply@y7-feedback.test>",
      headers: { "X-Y7-Delivery-ID": "notification_1" },
      subject: "Votre retour a été reçu",
      text: "Votre retour a été reçu. Référence : Y7-REF-12345678",
      to: "reporter@example.test",
    });
  });

  it("BDD-MAIL-002 completes in-product delivery without SMTP", async () => {
    const target = context();

    await expect(
      target.sender.deliver({
        deliveryId: "notification_2",
        channel: "in_product",
        payload: {
          kind: "feedback_accepted",
          locale: "en",
          reference: "Y7-REF-12345678",
        },
      }),
    ).resolves.toBe("delivered");
    expect(target.sendMail).not.toHaveBeenCalled();
  });

  it.each([
    [{ responseCode: 421 }, "retryable"],
    [{ responseCode: 550 }, "permanent"],
    [new Error("unavailable"), "retryable"],
  ] as const)("BDD-MAIL-003/004 maps SMTP failure %#", async (failure, expected) => {
    const target = context();
    target.sendMail.mockRejectedValueOnce(failure);

    await expect(
      target.sender.deliver({
        deliveryId: "notification_3",
        channel: "email",
        payload: {
          kind: "feedback_accepted",
          locale: "en",
          reference: "Y7-REF-12345678",
        },
      }),
    ).resolves.toBe(expected);
  });

  it("BDD-MAIL-005 rejects unsafe configuration and payloads before SMTP", async () => {
    const sendMail = vi.fn();
    expect(() =>
      createSmtpMailCatcherSender(
        { sendMail },
        { from: "no-reply@example.com", to: "person@example.com" },
      ),
    ).toThrow("MAIL_CATCHER_CONFIG_INVALID");

    const target = context();
    await expect(
      target.sender.deliver({
        deliveryId: "notification_4",
        channel: "email",
        payload: {
          kind: "feedback_accepted",
          locale: "fr",
          reference: "bad reference",
          accessProof: "must-never-be-sent",
        },
      }),
    ).resolves.toBe("permanent");
    expect(target.sendMail).not.toHaveBeenCalled();
  });

  it.each([
    [null],
    [{ kind: "wrong", locale: "fr", reference: "Y7-REF-12345678" }],
    [{ kind: "feedback_accepted", locale: "es", reference: "Y7-REF-12345678" }],
    [{ kind: "feedback_accepted", locale: "fr", reference: 7 }],
    [{ kind: "feedback_accepted", locale: "fr", reference: "bad" }],
  ])("BDD-MAIL-005 rejects malformed payload %#", async (payload) => {
    const target = context();
    await expect(
      target.sender.deliver({
        deliveryId: "notification_5",
        channel: "email",
        payload,
      }),
    ).resolves.toBe("permanent");
    expect(target.sendMail).not.toHaveBeenCalled();
  });

  it("BDD-MAIL-005 rejects malformed delivery IDs and transports", async () => {
    expect(() =>
      createSmtpMailCatcherSender(
        { sendMail: undefined as never },
        {
          from: "no-reply@y7-feedback.test",
          to: "reporter@example.test",
        },
      ),
    ).toThrow("MAIL_CATCHER_CONFIG_INVALID");
    expect(() =>
      createSmtpMailCatcherSender(
        { sendMail: vi.fn() },
        { from: "invalid", to: "reporter@example.test" },
      ),
    ).toThrow("MAIL_CATCHER_CONFIG_INVALID");

    const target = context();
    await expect(
      target.sender.deliver({
        deliveryId: "bad delivery id",
        channel: "email",
        payload: {
          kind: "feedback_accepted",
          locale: "fr",
          reference: "Y7-REF-12345678",
        },
      }),
    ).resolves.toBe("permanent");
  });

  it("BDD-MAIL-003 treats malformed SMTP errors as retryable", async () => {
    const target = context();
    target.sendMail.mockRejectedValueOnce({ responseCode: "bad" });
    await expect(
      target.sender.deliver({
        deliveryId: "notification_6",
        channel: "email",
        payload: {
          kind: "feedback_accepted",
          locale: "en",
          reference: "Y7-REF-12345678",
        },
      }),
    ).resolves.toBe("retryable");
  });
});

describe("Preview SMTP mail catcher environment", () => {
  const valid = {
    Y7_ENVIRONMENT: "preview",
    Y7_MAIL_CATCHER_HOST: "sandbox.smtp.mailtrap.io",
    Y7_MAIL_CATCHER_PORT: "2525",
    Y7_MAIL_CATCHER_SECURE: "false",
    Y7_MAIL_CATCHER_USER: "sandbox-user",
    Y7_MAIL_CATCHER_PASSWORD: "sandbox-password",
    Y7_MAIL_CATCHER_FROM: "Y7 Preview <no-reply@y7-feedback.test>",
    Y7_MAIL_CATCHER_TO: "reporter@example.test",
  } as const;

  it("BDD-MAIL-005 parses a complete Preview-only SMTP boundary", () => {
    expect(mailCatcherConfigFromEnvironment(valid)).toEqual({
      envelope: {
        from: "Y7 Preview <no-reply@y7-feedback.test>",
        to: "reporter@example.test",
      },
      smtp: {
        auth: { pass: "sandbox-password", user: "sandbox-user" },
        host: "sandbox.smtp.mailtrap.io",
        port: 2525,
        secure: false,
      },
    });
  });

  it.each([
    [{ ...valid, Y7_ENVIRONMENT: "production" }],
    [{ ...valid, Y7_MAIL_CATCHER_PORT: "0" }],
    [{ ...valid, Y7_MAIL_CATCHER_PORT: "65536" }],
    [{ ...valid, Y7_MAIL_CATCHER_HOST: "_invalid" }],
    [{ ...valid, Y7_MAIL_CATCHER_HOST: "" }],
    [{ ...valid, Y7_MAIL_CATCHER_SECURE: "maybe" }],
    [{ ...valid, Y7_MAIL_CATCHER_PASSWORD: "" }],
    [{ ...valid, Y7_MAIL_CATCHER_TO: "person@example.com" }],
  ])("BDD-MAIL-005 rejects unsafe environment %#", (environment) => {
    expect(() => mailCatcherConfigFromEnvironment(environment)).toThrow(
      "MAIL_CATCHER_CONFIG_INVALID",
    );
  });

  it("BDD-MAIL-005 composes the Node transport only after validation", () => {
    const sendMail = vi.fn();
    const createTransport = vi
      .spyOn(nodemailer, "createTransport")
      .mockReturnValue({ sendMail } as never);

    const sender = createNodeSmtpMailCatcherSender({
      ...valid,
      Y7_MAIL_CATCHER_SECURE: "true",
    });

    expect(createTransport).toHaveBeenCalledWith({
      auth: { pass: "sandbox-password", user: "sandbox-user" },
      host: "sandbox.smtp.mailtrap.io",
      port: 2525,
      secure: true,
    });
    expect(sender).toBeDefined();
    createTransport.mockRestore();
  });
});
