/**
 * What the first visit leaves out: the globe and the pieces of the flat map.
 * One chunk for both, so that the code they share with the page, Three.js, stays
 * inside the page's own chunk instead of being split off and counted in the first visit.
 */
export * from "./globe.ts";
export * from "./pieces.ts";
