/**
 * The escape hatch.
 *
 * Build it on day one, so no provider ever holds a decade of personal data hostage.
 * This is also the only backup that exists: Supabase's free tier has no automatic
 * backups at all — they start on the paid plan.
 *
 * Tombstoned events are included deliberately. An export is a copy of the record, not a
 * tidied view of it, and a deletion is part of the history.
 */

import { allEventsRaw, getProfile, getFoods, getCategories } from "@/db/local";

export interface Export {
  app: "spiralout";
  format: number;
  exported_at: string;
  timezone: string;
  counts: Record<string, number>;
  profile: unknown;
  events: unknown[];
  foods: unknown[];
  categories: unknown[];
}

export async function buildExport(): Promise<Export> {
  const [events, profile, foods, expense, income] = await Promise.all([
    allEventsRaw(),
    getProfile(),
    getFoods(),
    getCategories("expense"),
    getCategories("income"),
  ]);

  const counts: Record<string, number> = {};
  for (const e of events) counts[e.kind] = (counts[e.kind] ?? 0) + 1;

  return {
    app: "spiralout",
    format: 1,
    exported_at: new Date().toISOString(),
    timezone: "Asia/Kathmandu",
    counts: { total: events.length, ...counts },
    profile,
    events,
    foods,
    categories: [...expense, ...income],
  };
}

export const exportFilename = () =>
  `spiralout-${new Date().toISOString().slice(0, 10)}.json`;

/**
 * Hand the file to the user.
 *
 * An installed iOS PWA does not reliably honour a blob download, so this reports
 * whether it worked and the caller offers copy-to-clipboard as the fallback that
 * always does.
 */
export function downloadJson(json: string, filename: string): boolean {
  try {
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch {
    return false;
  }
}
