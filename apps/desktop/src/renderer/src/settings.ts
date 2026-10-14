// SPDX-License-Identifier: LicenseRef-Proprietary
// settings.ts - `.box/settings.json`: app-managed, non-truth preferences.
// Per DATA-MODEL §1 the file lives under .box/, is never user data, and
// missing/corrupt content degrades to defaults - never a crash. Writes are
// read-modify-write merged so unknown keys (forward tolerance, NFR-07)
// survive a round-trip.

export interface BoxSettings {
  ink?: { color?: string; size?: number };
  /** ext (lowercase, with dot) -> absolute app path for "Open with". */
  openWith?: Record<string, string>;
  [k: string]: unknown;
}

const REL = ".box/settings.json";

export async function loadSettings(root: string): Promise<BoxSettings> {
  try {
    const raw = await window.box?.readFile(root, REL);
    if (raw === null || raw === undefined) return {};
    const v = JSON.parse(raw) as unknown;
    if (v !== null && typeof v === "object" && !Array.isArray(v))
      return v as BoxSettings;
    return {};
  } catch {
    return {};
  }
}

/** Read-modify-write merge: `patch` keys overwrite; everything else the
 * file currently holds (including keys this version doesn't know) is
 * preserved. Debounced by the caller. */
export async function saveSettings(
  root: string,
  patch: Partial<BoxSettings>,
): Promise<void> {
  const cur = await loadSettings(root);
  const next: BoxSettings = {
    ...cur,
    ...patch,
    ink: { ...cur.ink, ...patch.ink },
    openWith: { ...cur.openWith, ...patch.openWith },
  };
  if (next.ink && Object.keys(next.ink).length === 0) delete next.ink;
  if (next.openWith && Object.keys(next.openWith).length === 0)
    delete next.openWith;
  await window.box?.writeFileAtomic(
    root,
    REL,
    JSON.stringify(next, null, 2) + "\n",
  );
}

/** Debounce helper: rapid pref changes (color clicks) coalesce to one
 * write per quiet window. */
export function makeSaver(root: string) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (patch: Partial<BoxSettings>) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void saveSettings(root, patch);
    }, 400);
  };
}
