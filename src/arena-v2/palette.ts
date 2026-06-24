/**
 * v2 "Blue Lock Electric" palette. The whole cel-shaded anime look keys off these.
 * Warm magenta strike energy against a cyan-rimmed hero over a cool indigo dusk.
 */
export const PAL = {
  skyZenith: 0x0a0e2a, // near-black indigo (top of sky)
  skyHorizon: 0x3a2a6b, // violet dusk (horizon glow)
  pitch: 0x1fa86a, // cooler turf
  pitchShadow: 0x0c5e44, // turf shadow band
  pitchLine: 0xdfe8ff, // field markings
  kitPrimary: 0x1238ff, // electric ultramarine (home kit)
  kitSecondary: 0xe8edff, // ice white trim
  skin: 0xf0b48a, // kept warm so the head reads against blue kit
  accent: 0xff2e88, // hot magenta: speed lines, impact burst, UI energy
  rim: 0x54f0ff, // cyan back-rim on the hero
  outline: 0x0b0a1f, // cold near-black ink line
  ball: 0xf3f6ff, // bright ball so the trail + glints pop
} as const;

export type PaletteKey = keyof typeof PAL;
