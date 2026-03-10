import { supabase } from "./supabase";

export interface UserPreferences {
  holding_order: string[];
  rate_order: string[];
  sort_field: string;
  sort_dir: string;
  display_mode: string;
  currency: string;
  theme: string;
  last_ibkr_sync: string | null;
}

const DEFAULTS: UserPreferences = {
  holding_order: [],
  rate_order: ["usd_sgd", "usd_krw", "sgd_krw"],
  sort_field: "value",
  sort_dir: "desc",
  display_mode: "value",
  currency: "USD",
  theme: "dark",
  last_ibkr_sync: null,
};

export async function getPreferences(userId: string): Promise<UserPreferences> {
  const { data, error } = await supabase
    .from("user_preferences")
    .select("holding_order, rate_order, sort_field, sort_dir, display_mode, currency, theme, last_ibkr_sync")
    .eq("user_id", userId)
    .single();

  if (error || !data) return { ...DEFAULTS };
  return { ...DEFAULTS, ...data };
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function savePreferences(userId: string, prefs: Partial<UserPreferences>) {
  // Debounce saves to avoid hammering the DB on rapid changes (e.g. drag)
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await supabase
      .from("user_preferences")
      .upsert(
        { user_id: userId, ...prefs, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
  }, 500);
}
