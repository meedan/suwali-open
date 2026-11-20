// -1 is the low tier the preloaded Suwali FAQ is created at, so hub content outranks it in
// retrieval. Nothing in the UI sets -1: the star toggles between 1 (default) and 2 (important).
export type PriorityTier = -1 | 1 | 2;
