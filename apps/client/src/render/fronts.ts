/**
 * How long a tile that changed hands lights the edge it was taken across.
 * An attack takes at least one tile every tick, so while it goes on its
 * front stays lit. The client keeps drawing for that long after a change.
 */
export const FRONT_SECONDS = 1.5;
