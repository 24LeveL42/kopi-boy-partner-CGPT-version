import type * as Leaflet from "leaflet";

const SIZE = 52;

const SCOOTER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${SIZE}" height="${SIZE}" aria-hidden="true"> <defs>  <linearGradient id="kbRiderG" x1="0" y1="0" x2="1" y2="1">   <stop offset="0" stop-color="#8B5CF6"/><stop offset="1" stop-color="#6D28D9"/>  </linearGradient> </defs> <circle cx="32" cy="32" r="29" fill="url(#kbRiderG)" stroke="#fff" stroke-width="3"/> <rect x="12" y="20" width="14" height="12" rx="2.5" fill="#22C55E"/> <path d="M15 24h8" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/> <path d="M17 33h16l4 5h-24z" fill="#fff"/> <path d="M33 33l4-11h5" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/> <path d="M37 38l5 4" stroke="#fff" stroke-width="3" stroke-linecap="round"/> <circle cx="20" cy="43" r="5" fill="#fff"/><circle cx="20" cy="43" r="2" fill="#6D28D9"/> <circle cx="44" cy="43" r="5" fill="#fff"/><circle cx="44" cy="43" r="2" fill="#6D28D9"/> <path d="M31 22l-1 11" stroke="#FDE68A" stroke-width="4.5" stroke-linecap="round"/> <path d="M32 25l8-2" stroke="#FDE68A" stroke-width="3" stroke-linecap="round"/> <circle cx="31.5" cy="16.5" r="4.5" fill="#FDE68A"/></svg>`;

// The scooter faces right; when the rider heads west (heading 180-360) it flips.
export function riderIcon(
  L: typeof Leaflet,
  opts: { heading?: number | null; stale?: boolean } = {}
): Leaflet.DivIcon {
  const flip = typeof opts.heading === "number" && opts.heading > 180 && opts.heading < 360;
  const stale = opts.stale === true;
  const html = `
    <div class="kb-rider ${stale ? "kb-rider--stale" : ""}">
      ${stale ? "" : '<span class="kb-rider__pulse"></span>'}
      <div class="kb-rider__icon" style="transform:${flip ? "scaleX(-1)" : "none"}">${SCOOTER_SVG}</div>
    </div>`;
  return L.divIcon({
    html,
    className: "kb-rider-wrap",
    iconSize: [SIZE, SIZE],
    iconAnchor: [SIZE / 2, SIZE / 2],
  });
}
