/**
 * Stable visual identity for a player, derived purely from their id string. Given the
 * same id you always get the same critter species and color, so a player looks like the
 * same character everywhere (profile, lobby, leaderboard) and matches who they are in the
 * arena. No randomness, no state - just a hash mapped onto the in-arena look.
 */

import { CritterKind, critterKindForIndex } from "./Critter";

/**
 * Curated profile palette. Built from the in-arena CRITTER_COLORS (see Arena.ts ~line 39)
 * so a player's profile critter never clashes with how co-shooters look on the pitch. We
 * deliberately omit the bright "you" gold (0xffc53d) - that is reserved for the local
 * player and applied explicitly via the isYou prop, not the hash.
 */
export const IDENTITY_PALETTE: number[] = [
  0x6f86b6, 0x57b89a, 0xc28a5a, 0x8b8fa6, 0x6da0a8,
];

/**
 * djb2 string hash, masked to a non-negative 31-bit integer. Stable across runs and
 * platforms; good enough spread for picking a species/color from small tables.
 */
export function hashId(id: string): number {
  let hash = 5381;
  for (let i = 0; i < id.length; i++) {
    // hash * 33 + charCode, kept in 32-bit range via |0.
    hash = ((hash << 5) + hash + id.charCodeAt(i)) | 0;
  }
  // Drop the sign bit so callers always get a non-negative index.
  return hash & 0x7fffffff;
}

/** The critter species for this id, matching the arena's index-based assignment. */
export function identityKind(id: string): CritterKind {
  return critterKindForIndex(hashId(id));
}

/** A stable, unique-ish color from the curated profile palette. */
export function identityColor(id: string): number {
  return IDENTITY_PALETTE[hashId(id) % IDENTITY_PALETTE.length];
}
