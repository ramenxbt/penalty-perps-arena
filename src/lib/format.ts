/** Small shared formatters so sibling views never drift on the same derived display. */

/** 1 -> "1st", 2 -> "2nd", etc. */
export function ordinal(n: number): string {
  const abs = Math.abs(n);
  const tens = abs % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (abs % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** First two letters of a name, uppercased, for an avatar tile. */
export function avatarInitials(name: string): string {
  const letters = name.replace(/[^A-Za-z]/g, "");
  return letters.slice(0, 2).toUpperCase() || "??";
}
