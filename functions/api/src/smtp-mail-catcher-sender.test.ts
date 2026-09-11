import { describe, expect, it, vi } from "vitest";
import nodemailer from "nodemailer";

import {
  createSmtpMailCatcherSender,
  createSmtpNotificationSender,
} from "./smtp-mail-catcher-sender";
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

  it.each([
    ["feedback_received", "fr", "Nouveau retour reçu"],
    ["feedback_received", "en", "New feedback received"],
    ["message_added", "fr", "Nouveau message"],
    ["message_added", "en", "New message"],
    ["feedback_under_review", "fr", "Retour en cours d’analyse"],
    ["feedback_under_review", "en", "Feedback under review"],
    ["clarification_requested", "fr", "Précision demandée"],
    ["clarification_requested", "en", "Clarification requested"],
    ["reporter_answered", "fr", "Nouvelle réponse"],
    ["reporter_answered", "en", "New reply"],
    ["feedback_resolved", "fr", "Retour résolu"],
    ["feedback_resolved", "en", "Feedback resolved"],
    ["feedback_closed", "fr", "Retour clôturé"],
    ["feedback_closed", "en", "Feedback closed"],
    ["feedback_reopened", "fr", "Retour rouvert"],
    ["feedback_reopened", "en", "Feedback reopened"],
    ["assignment_changed", "fr", "Attribution modifiée"],
    ["assignment_changed", "en", "Assignment changed"],
  ] as const)(
    "sends the public %s template in %s",
    async (kind, locale, expectedSubject) => {
      const target = context();
      await expect(
        target.sender.deliver({
          deliveryId: "notification_event",
          channel: "email",
          payload: {
            kind,
            locale,
            reference: "Y7-REF-12345678",
            recipient: { kind: "reporter", id: "reporter_1" },
          },
        }),
      ).resolves.toBe("delivered");
      expect(target.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ subject: expectedSubject }),
      );
      expect(JSON.stringify(target.sendMail.mock.calls)).not.toContain("reporter_1");
    },
  );

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
    [
      {
        kind: "message_added",
        locale: "fr",
        reference: "Y7-REF-12345678",
        recipient: null,
      },
    ],
    [
      {
        kind: "message_added",
        locale: "fr",
        reference: "Y7-REF-12345678",
        recipient: { kind: "reporter", id: "bad/id" },
      },
    ],
    [
      {
        kind: "message_added",
        locale: "fr",
        reference: "Y7-REF-12345678",
        recipient: { kind: "wrong", id: "reporter_1" },
      },
    ],
    [
      {
        kind: "message_added",
        locale: "fr",
        reference: "Y7-REF-12345678",
        recipient: { kind: "reporter", id: "reporter_1", extra: true },
      },
    ],
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

describe("Production SMTP notification sender", () => {
  it("BDD-MAIL-006 resolves the authoritative recipient only at delivery time", async () => {
    const sendMail = vi.fn(() => Promise.resolve());
    const resolve = vi.fn(() => Promise.resolve("reporter@example.com"));
    const sender = createSmtpNotificationSender(
      { sendMail },
      { from: "Y7 Feedback <no-reply@y7labs.com>" },
      { resolve },
    );

    await expect(
      sender.deliver({
        deliveryId: "notification_7",
        channel: "email",
        payload: {
          kind: "feedback_accepted",
          locale: "en",
          reference: "Y7-REF-12345678",
        },
      }),
    ).resolves.toBe("delivered");

    expect(resolve).toHaveBeenCalledWith("notification_7");
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: {
          from: "no-reply@y7labs.com",
          to: "reporter@example.com",
        },
        to: "reporter@example.com",
      }),
    );
  });

  it.each([
    [null, "permanent"],
    ["not-an-email", "permanent"],
  ] as const)(
    "BDD-MAIL-007 denies an unusable recipient %#",
    async (recipient, outcome) => {
      const sendMail = vi.fn();
      const sender = createSmtpNotificationSender(
        { sendMail },
        { from: "no-reply@y7labs.com" },
        { resolve: () => Promise.resolve(recipient) },
      );
      await expect(
        sender.deliver({
          deliveryId: "notification_8",
          channel: "email",
          payload: {
            kind: "feedback_accepted",
            locale: "fr",
            reference: "Y7-REF-12345678",
          },
        }),
      ).resolves.toBe(outcome);
      expect(sendMail).not.toHaveBeenCalled();
    },
  );

  it("BDD-MAIL-008 retries recipient authority failures without leaking it", async () => {
    const sendMail = vi.fn();
    const sender = createSmtpNotificationSender(
      { sendMail },
      { from: "no-reply@y7labs.com" },
      { resolve: () => Promise.reject(new Error("private@example.com")) },
    );
    await expect(
      sender.deliver({
        deliveryId: "notification_9",
        channel: "email",
        payload: {
          kind: "feedback_accepted",
          locale: "fr",
          reference: "Y7-REF-12345678",
        },
      }),
    ).resolves.toBe("retryable");
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("BDD-MAIL-016 validates Production transport, resolver and payload boundaries", async () => {
    expect(() =>
      createSmtpNotificationSender(
        { sendMail: undefined as never },
        { from: "no-reply@y7labs.com" },
        { resolve: vi.fn() },
      ),
    ).toThrow("SMTP_NOTIFICATION_CONFIG_INVALID");
    expect(() =>
      createSmtpNotificationSender(
        { sendMail: vi.fn() },
        { from: "invalid" },
        { resolve: vi.fn() },
      ),
    ).toThrow("SMTP_NOTIFICATION_CONFIG_INVALID");
    expect(() =>
      createSmtpNotificationSender(
        { sendMail: vi.fn() },
        { from: "no-reply@y7labs.com" },
        { resolve: undefined as never },
      ),
    ).toThrow("SMTP_NOTIFICATION_CONFIG_INVALID");

    const resolve = vi.fn(() => Promise.resolve("person@example.com"));
    const sender = createSmtpNotificationSender(
      { sendMail: vi.fn() },
      { from: "no-reply@y7labs.com" },
      { resolve },
    );
    await expect(
      sender.deliver({
        deliveryId: "notification_10",
        channel: "in_product",
        payload: null,
      }),
    ).resolves.toBe("delivered");
    await expect(
      sender.deliver({
        deliveryId: "bad delivery",
        channel: "email",
        payload: null,
      }),
    ).resolves.toBe("permanent");
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each([
    [Object.assign(new Error("smtp"), { responseCode: 421 }), "retryable"],
    [Object.assign(new Error("smtp"), { responseCode: 550 }), "permanent"],
    [Object.assign(new Error("smtp"), { responseCode: "bad" }), "retryable"],
  ] as const)(
    "BDD-MAIL-017 maps Production SMTP failure %#",
    async (failure, result) => {
      const sender = createSmtpNotificationSender(
        { sendMail: vi.fn(() => Promise.reject(failure)) },
        { from: "no-reply@y7labs.com" },
        { resolve: () => Promise.resolve("person@example.com") },
      );
      await expect(
        sender.deliver({
          deliveryId: "notification_11",
          channel: "email",
          payload: {
            kind: "feedback_accepted",
            locale: "fr",
            reference: "Y7-REF-12345678",
          },
        }),
      ).resolves.toBe(result);
    },
  );
});
