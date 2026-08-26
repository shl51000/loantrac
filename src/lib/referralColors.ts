// Fixed palette assigned in the order referrals were created (referrals.color_seq).
// Tailwind class names are spelled out in full (not built with string
// interpolation) so Tailwind's scanner can find and keep them.

export interface ReferralColor {
  dot: string; // small colour dot
  badgeBg: string;
  badgeText: string;
  tabActiveBg: string;
  tabActiveText: string;
  chart: string; // hex, for Recharts fills
}

const PALETTE: ReferralColor[] = [
  { dot: "bg-teal-500", badgeBg: "bg-teal-100", badgeText: "text-teal-800", tabActiveBg: "bg-teal-600", tabActiveText: "text-white", chart: "#0d9488" },
  { dot: "bg-fuchsia-500", badgeBg: "bg-fuchsia-100", badgeText: "text-fuchsia-800", tabActiveBg: "bg-fuchsia-600", tabActiveText: "text-white", chart: "#c026d3" },
  { dot: "bg-orange-500", badgeBg: "bg-orange-100", badgeText: "text-orange-800", tabActiveBg: "bg-orange-600", tabActiveText: "text-white", chart: "#ea580c" },
  { dot: "bg-indigo-500", badgeBg: "bg-indigo-100", badgeText: "text-indigo-800", tabActiveBg: "bg-indigo-600", tabActiveText: "text-white", chart: "#4f46e5" },
  { dot: "bg-cyan-500", badgeBg: "bg-cyan-100", badgeText: "text-cyan-800", tabActiveBg: "bg-cyan-600", tabActiveText: "text-white", chart: "#0891b2" },
  { dot: "bg-rose-500", badgeBg: "bg-rose-100", badgeText: "text-rose-800", tabActiveBg: "bg-rose-600", tabActiveText: "text-white", chart: "#e11d48" },
  { dot: "bg-lime-500", badgeBg: "bg-lime-100", badgeText: "text-lime-800", tabActiveBg: "bg-lime-600", tabActiveText: "text-white", chart: "#65a30d" },
  { dot: "bg-violet-500", badgeBg: "bg-violet-100", badgeText: "text-violet-800", tabActiveBg: "bg-violet-600", tabActiveText: "text-white", chart: "#7c3aed" },
  { dot: "bg-amber-500", badgeBg: "bg-amber-100", badgeText: "text-amber-800", tabActiveBg: "bg-amber-600", tabActiveText: "text-white", chart: "#d97706" },
  { dot: "bg-sky-500", badgeBg: "bg-sky-100", badgeText: "text-sky-800", tabActiveBg: "bg-sky-600", tabActiveText: "text-white", chart: "#0284c7" },
];

// color_seq starts at 1 (Postgres identity column), so shift to a 0-based index.
export function getReferralColor(colorSeq: number): ReferralColor {
  const index = Math.max(0, colorSeq - 1) % PALETTE.length;
  return PALETTE[index];
}
