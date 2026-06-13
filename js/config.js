/* ─────────────────────────────────────────────────────────────
   تنظیمات Supabase
   ─────────────────────────────────────────────────────────────
   اگر این دو مقدار خالی بمانند، بازی در حالت «محلی» اجرا می‌شود:
   آمار و ELO فقط در همین مرورگر شما ذخیره می‌شود و لیدربورد نمایشی است.

   برای روشن‌کردن لیدربورد جهانی آنلاین:
     ۱) یک پروژهٔ رایگان در https://supabase.com بساز.
     ۲) فایل supabase/migrations/0001_init.sql را در SQL Editor اجرا کن.
     ۳) از Project Settings → API، مقادیر زیر را کپی و این‌جا بگذار.

   نکتهٔ امنیتی: کلید anon عمداً عمومی است و گذاشتنش این‌جا (حتی در
   ریپوی پابلیک) امن است؛ Row Level Security از دیتابیس محافظت می‌کند.
   هرگز کلید service_role را این‌جا نگذار.
   ───────────────────────────────────────────────────────────── */
window.MAFIA_CONFIG = {
  supabaseUrl: "https://oqnypjgibccarmmwnwyl.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9xbnlwamdpYmNjYXJtbXdud3lsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNzg4ODMsImV4cCI6MjA5Njk1NDg4M30.1shBjEbLzITZjJFIsuGIcaeI7jbKpTBHYaBy5TTb-RI"
};
