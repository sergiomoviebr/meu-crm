import { enUS, ko, ptBR } from "date-fns/locale";
import type { Locale } from "date-fns";

// Maps this app's NEXT_PUBLIC_APP_LOCALE values to date-fns locale objects,
// so month/weekday names and relative-time phrasing ("3 hours ago") follow
// the same language as the message catalogue in messages/*.json.
const DATE_FNS_LOCALES: Record<string, Locale> = {
  en: enUS,
  ko,
  "pt-BR": ptBR,
};

export function getDateFnsLocale(locale: string): Locale {
  return DATE_FNS_LOCALES[locale] ?? enUS;
}
