/**
 * Facebook, Instagram, Messenger, TikTok, WeChat and LINE open links in
 * their own built-in browser, where Google refuses to sign anyone in
 * ("disallowed_useragent"). People arriving from an ad are told to open the
 * page in their real browser first. A wrong guess only shows an extra hint:
 * the Google button stays.
 *
 * Markers, by app:
 *   Facebook / Messenger  FBAN, FBAV, FB_IAB, FBIOS, FB4A, Messenger
 *   Instagram             Instagram
 *   TikTok                musical_ly (global), trill (Asia builds),
 *                         BytedanceWebview, TikTok
 *   WeChat                MicroMessenger
 *   LINE                  "Line/<version>", case-sensitive: a loose
 *                         case-insensitive "line" would also match "Linux"
 *                         in every Android user agent.
 */
const IN_APP_MARKERS = /FBAN|FBAV|FB_IAB|FBIOS|FB4A|Instagram|Messenger|MicroMessenger|musical_ly|\btrill_|BytedanceWebview|TikTok/i;
const LINE_MARKER = /\bLine\/\d/;

export function isInAppBrowser(userAgent: string | null | undefined): boolean {
  return !!userAgent && (IN_APP_MARKERS.test(userAgent) || LINE_MARKER.test(userAgent));
}
