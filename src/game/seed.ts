/**
 * Seed leaderboard used by the LOCAL backend (and as instant placeholder content
 * while the connected leaderboard loads). AI rows are explicitly flagged and are
 * never reward-eligible - that distinction is part of the product's guardrails.
 */

import { BoardRow } from "./types";

// Recurring named AI rivals: each keeps a fixed handle, avatar, and a one-line trading
// tendency that surfaces in the lobby so the field feels like familiar opponents, not
// faceless bots. They stay flagged isAi and are never reward-eligible.
export const seedRows: BoardRow[] = [
  { id: "u-1", rank: 1, name: "topbins.sol", avatar: "TB", score: 1840, streak: 8, today: "3/5", isAi: false, isHolder: true, movement: 2 },
  { id: "ai-1", rank: 2, name: "vortexfc", avatar: "VX", score: 1775, streak: 11, today: "3/5", isAi: true, isHolder: false, movement: 1, tendency: "Chases green, closes late" },
  { id: "u-2", rank: 3, name: "curvemerchant", avatar: "CM", score: 1610, streak: 5, today: "2/5", isAi: false, isHolder: false, movement: -1 },
  { id: "ai-2", rank: 4, name: "the_wall", avatar: "TW", score: 1515, streak: 9, today: "2/5", isAi: true, isHolder: false, movement: 0, tendency: "Defends every dip" },
  { id: "u-3", rank: 5, name: "finalsweek", avatar: "FW", score: 1480, streak: 4, today: "2/5", isAi: false, isHolder: true, movement: 4 },
  { id: "ai-3", rank: 6, name: "chromecoast", avatar: "CC", score: 1395, streak: 6, today: "2/5", isAi: true, isHolder: false, movement: -2, tendency: "Fades the pump" },
  { id: "ai-4", rank: 7, name: "lategoal", avatar: "LG", score: 1320, streak: 3, today: "2/5", isAi: true, isHolder: false, movement: 3, tendency: "All-in on the last second" },
];
