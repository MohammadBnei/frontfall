type Attributes = Record<string, string | number | boolean | undefined>;
type Child = Node | string;

/** Creates an element; attributes set to false or undefined are left out. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    element.setAttribute(name, value === true ? "" : String(value));
  }
  element.append(...children);
  return element;
}
