import en from "./en.json" with { type: "json" };
import fr from "./fr.json" with { type: "json" };

/** English is the reference catalogue: every other language has exactly its keys. */
export type MessageKey = keyof typeof en;

/** Keys that take a count, written in the catalogues as `key.one`, `key.other`, … */
export type PluralKey = {
  [K in MessageKey]: K extends `${infer Base}.other` ? Base : never;
}[MessageKey];

export type Params = Readonly<Record<string, string | number>>;

const CATALOGUES = { en, fr } satisfies Record<string, Record<MessageKey, string>>;

export type Language = keyof typeof CATALOGUES;

export const LANGUAGES = Object.keys(CATALOGUES) as readonly Language[];

const STORAGE_KEY = "frontfall.language";

/** Picks the first supported language among BCP 47 tags such as `fr-CA`, English otherwise. */
export function detectLanguage(tags: readonly string[]): Language {
  for (const tag of tags) {
    const primary = tag.toLowerCase().split("-")[0];
    if (isLanguage(primary)) return primary;
  }
  return "en";
}

function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && Object.hasOwn(CATALOGUES, value);
}

// Storage can be missing or throw on access (private mode, blocked cookies):
// the choice is then simply not remembered.
function readStored(): string | null {
  try {
    return globalThis.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function store(lang: Language): void {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Not remembered, see readStored.
  }
}

function initialLanguage(): Language {
  const stored = readStored();
  if (isLanguage(stored)) return stored;
  const nav = globalThis.navigator as Navigator | undefined;
  return detectLanguage(nav?.languages ?? (nav?.language ? [nav.language] : []));
}

let current = initialLanguage();
const listeners = new Set<(lang: Language) => void>();

export function getLanguage(): Language {
  return current;
}

/** Switches language in place, remembers the choice and notifies listeners. */
export function setLanguage(lang: Language): void {
  if (!isLanguage(lang) || lang === current) return;
  current = lang;
  store(lang);
  for (const listener of listeners) listener(lang);
}

/** Calls `listener` after each language change; the returned function unsubscribes. */
export function onLanguageChange(listener: (lang: Language) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function format(template: string, params: Params): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}

function lookup(key: string): string | undefined {
  const catalogue: Record<string, string> = CATALOGUES[current];
  const fallback: Record<string, string> = CATALOGUES.en;
  return catalogue[key] ?? fallback[key];
}

/** Translates `key` into the current language, replacing `{name}` placeholders. */
export function t(key: MessageKey, params: Params = {}): string {
  return format(lookup(key) ?? key, params);
}

/** Like `t`, choosing the plural form of `key` that matches `count`, also available as `{count}`. */
export function plural(key: PluralKey, count: number, params: Params = {}): string {
  const category = new Intl.PluralRules(current).select(count);
  const template = lookup(`${key}.${category}`) ?? lookup(`${key}.other`) ?? key;
  return format(template, { ...params, count });
}

/**
 * Fills elements under `root` marked with `data-i18n="key"` (text) and
 * `data-i18n-attr="aria-label:key;title:key"` (attributes). Safe to call again
 * after a language change.
 */
export function applyTranslations(root: ParentNode): void {
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = element.dataset.i18n;
    if (key) element.textContent = t(key as MessageKey);
  }
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n-attr]")) {
    for (const pair of (element.dataset.i18nAttr ?? "").split(";")) {
      const [attribute, key] = pair.split(":").map((part) => part.trim());
      if (attribute && key) element.setAttribute(attribute, t(key as MessageKey));
    }
  }
  const doc = "documentElement" in root ? (root as Document) : root.ownerDocument;
  if (doc) doc.documentElement.lang = current;
}
