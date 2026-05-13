/**
 * Pourcentage de variation entre curr et prev, formate '+12 %' / '-5 %'.
 * Si prev=0 et curr>0 renvoie '+100 %' ; si prev=0 et curr=0 renvoie '+0 %'.
 */
export function pctDelta(curr: number, prev: number): string {
  if (prev === 0) {
    return curr > 0 ? "+100 %" : "+0 %";
  }
  const pct = Math.round(((curr - prev) / prev) * 100);
  return (pct >= 0 ? "+" : "") + pct + " %";
}

/** Difference absolue formatee '+3' / '-2'. */
export function absDelta(curr: number, prev: number): string {
  const d = curr - prev;
  return (d >= 0 ? "+" : "") + d;
}

/** Couleur HSL deterministe derivee de l'id (hash simple). */
export function deterministicColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 65%, 50%)`;
}
