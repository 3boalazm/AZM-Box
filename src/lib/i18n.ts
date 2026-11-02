import { useCallback } from "react";
import { usePreferences } from "./preferences";
import type { Language } from "./preferences";
import { AR } from "./ar";

const dictionaries: Record<Language, Record<string, string>> = { en: {}, ar: AR };

export type Translate = (text: string, vars?: Record<string, string | number>) => string;

/**
 * The English text IS the key, so a string that has no translation yet simply
 * shows in English instead of breaking. `{name}` placeholders are filled from vars.
 */
export function translate(language: Language, text: string, vars?: Record<string, string | number>): string {
  const template = dictionaries[language][text] ?? text;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}

export function useT(): Translate {
  const { language } = usePreferences();
  return useCallback((text, vars) => translate(language, text, vars), [language]);
}
