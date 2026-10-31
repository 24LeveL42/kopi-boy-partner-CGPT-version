import type * as Leaflet from "leaflet";

/** Rider marker size in px. The pulse ring grows to about 1.5x this (36px). */
export const RIDER_ICON_SIZE = 24;
const SIZE = RIDER_ICON_SIZE;

// A purple disc with a 2px white border and a simple white scooter, drawn on a
// 24-unit grid so it stays crisp at 24px.
const SCOOTER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${SIZE}" height="${SIZE}" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#7B3FE4" stroke="#fff" stroke-width="2"/><rect x="5.5" y="8" width="5" height="4" rx="1" fill="#fff"/><path d="M7 14h6.5l2-5.5H18" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="16" r="1.9" fill="#fff"/><circle cx="16.5" cy="16" r="1.9" fill="#fff"/></svg>`;

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
    // Centre of the disc sits exactly on the rider's position.
    iconAnchor: [SIZE / 2, SIZE / 2],
  });
}

/** Drop-off pin size in px (width x height); the tip is at the bottom centre. */
export const DROPOFF_PIN_SIZE: [number, number] = [20, 26];

const PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 26" width="20" height="26" aria-hidden="true"><path d="M10 25C10 25 2 15.5 2 9.5a8 8 0 0 1 16 0C18 15.5 10 25 10 25z" fill="#7B3FE4" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><circle cx="10" cy="9.5" r="3" fill="#fff"/></svg>`;

/** The customer's drop-off pin, shown only after pickup. */
export function dropoffIcon(L: typeof Leaflet): Leaflet.DivIcon {
  const [w, h] = DROPOFF_PIN_SIZE;
  return L.divIcon({
    html: `<div class="kb-dropoff">${PIN_SVG}</div>`,
    className: "kb-dropoff-wrap",
    iconSize: [w, h],
    // The pin's tip, not its middle, sits on the address.
    iconAnchor: [w / 2, h],
    tooltipAnchor: [0, -h],
  });
}
