// ابزارهای مشترک توابع Edge: کلاینت service_role، احراز کاربر، CORS.
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

export function preflight(req: Request): Response | null {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  return null;
}

// کلاینت با service_role — RLS را دور می‌زند. فقط داخل سرور.
export function admin(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

// کاربرِ پشتِ توکنِ Authorization را برمی‌گرداند (یا null).
export async function getUser(req: Request) {
  const authz = req.headers.get("Authorization") ?? "";
  const token = authz.replace("Bearer ", "").replace("bearer ", "").trim();
  if (!token) return null;
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } },
  );
  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) return null;
  return data.user;
}

// زمان‌بندی فازها (ثانیه)
export const PHASE_SECS = {
  reveal: 12,
  night: 25,
  day: 30,
  "day-vote": 25,
  resolved: 8,
  countdown: 30,
} as const;

export const deadline = (secs: number) => new Date(Date.now() + secs * 1000).toISOString();
