import nodemailer from "nodemailer";

import {
  createSmtpMailCatcherSender,
  type SmtpMailCatcherConfig,
  validateSmtpMailCatcherConfig,
} from "./smtp-mail-catcher-sender.js";

type Environment = Readonly<Record<string, string | undefined>>;

export interface NodeMailCatcherConfig {
  readonly envelope: SmtpMailCatcherConfig;
  readonly smtp: {
    readonly auth: { readonly pass: string; readonly user: string };
    readonly host: string;
    readonly port: number;
    readonly secure: boolean;
  };
}

function required(environment: Environment, key: string, maximum = 1_024): string {
  const value = environment[key];
  if (typeof value !== "string" || !value || value.length > maximum) {
    throw new Error("MAIL_CATCHER_CONFIG_INVALID");
  }
  return value;
}

export function mailCatcherConfigFromEnvironment(
  environment: Environment,
): NodeMailCatcherConfig {
  if (environment.Y7_ENVIRONMENT !== "preview") {
    throw new Error("MAIL_CATCHER_CONFIG_INVALID");
  }
  const host = required(environment, "Y7_MAIL_CATCHER_HOST", 253);
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/u.test(host)) {
    throw new Error("MAIL_CATCHER_CONFIG_INVALID");
  }
  const port = Number(required(environment, "Y7_MAIL_CATCHER_PORT", 5));
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("MAIL_CATCHER_CONFIG_INVALID");
  }
  const secureValue = required(environment, "Y7_MAIL_CATCHER_SECURE", 5);
  if (secureValue !== "true" && secureValue !== "false") {
    throw new Error("MAIL_CATCHER_CONFIG_INVALID");
  }
  const config = {
    envelope: {
      from: required(environment, "Y7_MAIL_CATCHER_FROM", 320),
      to: required(environment, "Y7_MAIL_CATCHER_TO", 320),
    },
    smtp: {
      auth: {
        pass: required(environment, "Y7_MAIL_CATCHER_PASSWORD"),
        user: required(environment, "Y7_MAIL_CATCHER_USER"),
      },
      host,
      port,
      secure: secureValue === "true",
    },
  } as const;

  validateSmtpMailCatcherConfig(config.envelope);
  return config;
}

export function createNodeSmtpMailCatcherSender(environment: Environment) {
  const config = mailCatcherConfigFromEnvironment(environment);
  const transport = nodemailer.createTransport(config.smtp);
  return createSmtpMailCatcherSender(transport, config.envelope);
}
