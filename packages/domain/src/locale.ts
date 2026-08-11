export type Locale = "fr" | "en";

export const supportedLocales = ["fr", "en"] as const satisfies readonly Locale[];

export function isLocale(value: string): value is Locale {
  return supportedLocales.some((locale) => locale === value);
}
