/**
 * Opened from the home screen ("Add to Home Screen" / installed app). On an
 * iPhone that app keeps its own sign-in, separate from Safari and WhatsApp,
 * so an owner who claimed their shop in WhatsApp is signed out there.
 * Browser only; false on the server.
 */
export function isStandaloneApp(): boolean {
  if (typeof window === "undefined") return false;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia?.("(display-mode: standalone)").matches === true;
}
