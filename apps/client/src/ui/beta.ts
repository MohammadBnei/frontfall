import { RELEASE, isBeta } from "../release.ts";
import { h } from "./dom.ts";

/** The beta badge with the version before 1.0, the plain version from 1.0 on. */
export function betaBadge(className: string): HTMLElement | undefined {
  if (!isBeta()) return h("span", { class: `version-tag ${className}` }, `v${RELEASE}`);
  return h(
    "span",
    {
      class: `beta-badge ${className}`,
      "data-i18n-attr": "title:beta.notice",
    },
    h("strong", { "data-i18n": "beta.label" }),
    h("span", { class: "beta-version" }, `v${RELEASE}`),
  );
}
