import type { AssetRecipe } from './types';

// Bake-off candidates live outside the repo. Nothing enters this
// registry until a later Look Dev signoff; EBR-76 can resolve ids to recipes.
export const assets: Readonly<Record<string, AssetRecipe>> = {};
