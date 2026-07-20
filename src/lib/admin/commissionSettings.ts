/**
 * Commission settings persistence.
 *
 * The admin finance page let you type a commission % but only toasted; the
 * value was lost on refresh. This stores it in `platform_settings` (single-row
 * key/value) so it actually sticks and can be read by payout logic later.
 */
import { supabase } from "@/integrations/supabase/client";

const KEY = "marketplace_commission_rate";
export const DEFAULT_COMMISSION_PERCENT = 10;

export async function getCommissionPercent(): Promise<number> {
  const { data } = await (supabase as any)
    .from("platform_settings")
    .select("value")
    .eq("key", KEY)
    .maybeSingle();
  const v = Number(data?.value);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_COMMISSION_PERCENT;
}

export async function setCommissionPercent(percent: number): Promise<void> {
  if (!Number.isFinite(percent) || percent < 0 || percent > 50) {
    throw new Error("Commission must be between 0% and 50%");
  }
  await (supabase as any)
    .from("platform_settings")
    .upsert({ key: KEY, value: String(percent), updated_at: new Date().toISOString() }, { onConflict: "key" });
}
