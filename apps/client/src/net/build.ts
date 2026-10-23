declare const __FRONTFALL_BUILD__: string | undefined;

/**
 * Build of this page, set by Vite from FRONTFALL_VERSION. The server refuses
 * a page from another build: the engine or the balance may differ, and the
 * game would desynchronise. Development builds are "dev" and always accepted.
 */
export const BUILD = typeof __FRONTFALL_BUILD__ === "string" ? __FRONTFALL_BUILD__ : "dev";
