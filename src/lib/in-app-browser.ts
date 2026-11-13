/**
 * Facebook, Instagram and Messenger open links in their own built-in
 * browser, where Google refuses to sign anyone in ("disallowed_useragent").
 * People arriving from a Facebook ad are told to open the page in their
 * real browser first. A wrong guess only shows an extra hint: the Google
 * button stays.
 */
const IN_APP_MARKERS = /FBAN|FBAV|FB_IAB|FBIOS|FB4A|Instagram|Messenger/i;

export function isInAppBrowser(userAgent: string | null | undefined): boolean {
  return !!userAgent && IN_APP_MARKERS.test(userAgent);
}
