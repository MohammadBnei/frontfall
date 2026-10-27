import { loadLanguage } from "../src/i18n/index.ts";

// The page loads its catalogue before it shows anything; tests start the same way.
await Promise.all([loadLanguage("en"), loadLanguage("fr")]);
