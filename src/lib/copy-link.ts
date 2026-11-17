/**
 * Copies text for the "Copy link" button on the in-app browser banner.
 * In-app browsers (Facebook, Instagram, TikTok, WeChat, LINE…) often have no
 * navigator.clipboard (or refuse it), so this falls back to the older
 * select-and-copy trick before giving up. Never throws.
 */

export interface CopyEnv {
  clipboard?: { writeText(text: string): Promise<void> } | null;
  /** The select-and-copy fallback; returns whether it worked. */
  legacyCopy?: (text: string) => boolean;
}

export async function copyText(text: string, env: CopyEnv): Promise<boolean> {
  try {
    if (env.clipboard && typeof env.clipboard.writeText === "function") {
      await env.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy copy.
  }
  try {
    return env.legacyCopy ? env.legacyCopy(text) : false;
  } catch {
    return false;
  }
}

/** document.execCommand("copy") through a hidden, read-only textarea. Browser only. */
export function legacyCopy(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "0";
  area.style.opacity = "0";
  document.body.appendChild(area);
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(area);
  }
}
