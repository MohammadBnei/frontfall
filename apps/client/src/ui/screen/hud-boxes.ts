/** A panel of the HUD and where it sits on screen. */
export interface HudBox {
  readonly element: Element;
  readonly rect: DOMRect;
}

/**
 * Tells where the panels of the HUD sit whenever one of them comes, goes or
 * changes size, and when the window does. A resize observer reports once the
 * browser has laid the page out for its frame, so reading the boxes then
 * costs nothing; read after each update instead, they forced a layout of
 * their own, a millisecond or more ten times a second. Returns the cleanup.
 */
export function watchHudBoxes(hud: HTMLElement, moved: (boxes: HudBox[]) => void): () => void {
  const measure = (): void => {
    moved(
      Array.from(hud.children, (element) => ({ element, rect: element.getBoundingClientRect() })),
    );
  };
  const sizes = new ResizeObserver(measure);
  for (const child of hud.children) sizes.observe(child);
  // A panel just added is reported once it has a size: when it is first laid out.
  const panels = new MutationObserver((changes) => {
    for (const change of changes) {
      for (const node of change.addedNodes) if (node instanceof Element) sizes.observe(node);
      for (const node of change.removedNodes) if (node instanceof Element) sizes.unobserve(node);
    }
    // A panel gone leaves no size to report: the others are read on the next frame.
    if (changes.some((change) => change.removedNodes.length > 0)) requestAnimationFrame(measure);
  });
  panels.observe(hud, { childList: true });
  // Panels move with the window without always changing size.
  let pending = 0;
  const resize = (): void => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(measure);
  };
  window.addEventListener("resize", resize);
  return () => {
    sizes.disconnect();
    panels.disconnect();
    cancelAnimationFrame(pending);
    window.removeEventListener("resize", resize);
  };
}
