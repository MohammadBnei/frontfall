# Client

The browser client lives in [`apps/client`](../apps/client). This document
covers the conventions that are not obvious from the code.

## Translations

Every text the player can read comes from a catalogue in
[`apps/client/src/i18n`](../apps/client/src/i18n): `en.json` is the reference,
`fr.json` and any later language must have exactly the same keys. The language
is taken from the browser's preferences (French for any `fr` variant, English
otherwise) until the player picks one, and the choice is kept in
`localStorage`. Changing it with `setLanguage` updates the page in place,
without a reload.

Keys are flat and grouped by screen, such as `status.connecting`. Messages use
named placeholders in braces:

```ts
import { plural, t } from "./i18n/index.ts";

t("status.connected", { player: "p3" }); // "Connected as p3"
plural("lobby.players", 4); // "4 players", the count is also {count}
```

Static text in `index.html` is marked instead of written in code:
`data-i18n="key"` sets the element's text and
`data-i18n-attr="aria-label:key;title:key"` sets attributes, with placeholder
values, if any, as a JSON object in `data-i18n-params`. The English text
stays in the HTML so the page reads correctly before the script runs.
`applyTranslations` fills them, and the client calls it again whenever the
language changes. Code that writes text itself should listen with
`onLanguageChange` and write it again.

### Adding a message

1. Add the key and its English text to `en.json`.
2. Add the same key, with the same placeholders, to every other catalogue.
3. Use it with `t("your.key")`; the key type comes from `en.json`, so a typo
   does not compile.

For a message that depends on a number, add one key per plural category of
the language, `your.key.one` and `your.key.other` for English and French, and
call `plural("your.key", count)`. A category a catalogue lacks falls back to
`other`.

### Adding a language

1. Copy `en.json` to `<code>.json`, where `<code>` is the primary language
   subtag (`de`, `es`, …), and translate the values.
2. Import it and add it to `CATALOGUES` in `i18n/index.ts`, and add its
   native name to `LANGUAGES` for the language menu.

The tests in `apps/client/test/i18n.test.ts` check that every catalogue has the
English keys and placeholders, and that no source file outside `i18n/` and
`render/` writes literal text into the page.
