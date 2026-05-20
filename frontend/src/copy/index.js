// Microcopy directory bootstrap. Single source of truth for user-facing strings
// that live outside of any one screen. Add named exports here as the catalog grows.
export * from './h10IntroCopy.js';
// Note: insightTemplates.js is owned by Coder C; add `export * from './insightTemplates.js';`
// once that file lands. Keeping this file lean avoids build breaks during the parallel rollout.
