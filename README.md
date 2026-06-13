<div dir="rtl">

# 🎭 مافیا AI

پلتفرم بازی **مافیا** با گردانندهٔ هوش مصنوعی، رتبه‌بندی رقابتی، تورنمنت و تحلیل بازی — کاملاً در مرورگر، بدون نصب.

> **شهر هرگز نمی‌خوابد.**

🔗 **دموی زنده:** https://mafia-ai-lidamoda.vercel.app

---

## ✨ ویژگی‌ها

- **صفحهٔ فرود حرفه‌ای** با تم تاریک سینمایی و حس ای‌اسپورت.
- **بازی کامل تک‌نفره در برابر ربات‌ها** — پخش نقش، فاز شب/روز، رأی‌گیری زنده، صفحهٔ پایان.
- **نقش‌ها:** مافیا، پدرخوانده، دکتر، کارآگاه، شهروند، تک‌تیرانداز، شهردار، محافظ، جوکر.
- **لیدربورد و پروفایل ماندگار** روی Supabase (با ELO و آمار نقش‌ها).
- **حالت محلی خودکار:** اگر Supabase تنظیم نباشد، آمار در همان مرورگر ذخیره می‌شود و بازی کامل کار می‌کند.

---

## 🗂️ ساختار پروژه

```
mafia-ai/
├── index.html                     # صفحهٔ فرود (نقطهٔ ورود)
├── mafia-game.html                # خودِ بازی
├── js/
│   ├── config.js                  # آدرس و کلید عمومی Supabase (خالی = حالت محلی)
│   ├── config.example.js          # نمونهٔ تنظیمات
│   └── supabase-client.js         # لایهٔ دیتابیس (MafiaDB)
├── supabase/
│   └── migrations/
│       └── 0001_init.sql          # جدول‌ها + RLS + تابع امن record_match
├── vercel.json
├── .gitignore
├── .env.example
└── LICENSE
```

---

## 🚀 اجرای محلی

هیچ وابستگی‌ای لازم نیست. کافی است `index.html` را در مرورگر باز کنی، یا یک سرور سادهٔ استاتیک بالا بیاوری:

```bash
# پایتون
python -m http.server 8080

# یا Node
npx serve .
```

سپس: `http://localhost:8080/`

در این حالت بازی در **حالت محلی** اجرا می‌شود (آمار در localStorage مرورگر).

---

## 🗄️ راه‌اندازی Supabase (برای لیدربورد جهانی)

۱. در [supabase.com](https://supabase.com) یک پروژهٔ رایگان بساز.
۲. وارد **SQL Editor** شو، محتوای `supabase/migrations/0001_init.sql` را اجرا کن.
۳. از **Project Settings → API** این دو مقدار را بردار و در `js/config.js` بگذار:

```js
window.MAFIA_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT-REF.supabase.co",
  supabaseAnonKey: "YOUR-PUBLIC-ANON-KEY"
};
```

تمام. حالا نتایج بازی روی سرور ثبت و لیدربورد جهانی خوانده می‌شود.

> 🔒 **امنیت:** کلید `anon` عمداً عمومی است؛ گذاشتنش در `config.js` (حتی در ریپوی پابلیک) امن است چون **RLS** و تابع `record_match` از دیتابیس محافظت می‌کنند. کلید `service_role` را **هرگز** سمت‌کلاینت یا داخل ریپو نگذار.

---

## ▲ استقرار روی Vercel

```bash
npm i -g vercel        # یک‌بار
vercel                 # پیش‌نمایش
vercel --prod          # نسخهٔ پروداکشن
```

یا از داشبورد Vercel، ریپوی GitHub را **Import** کن. پروژه استاتیک است؛ نیازی به Build Command نیست (Output Directory = ریشهٔ پروژه).

---

## 🐙 انتشار روی GitHub (پابلیک)

```bash
cd mafia-ai
git init
git add .
git commit -m "Initial commit: Mafia AI platform"
gh repo create mafia-ai --public --source=. --push
# یا به‌صورت دستی یک ریپوی خالی بساز و:
# git remote add origin https://github.com/<user>/mafia-ai.git
# git branch -M main && git push -u origin main
```

پروژه با مجوز **MIT** منتشر می‌شود؛ هر کسی می‌تواند fork کند، تغییر دهد و نسخهٔ خودش را با Supabase خودش اجرا کند.

---

## 🤝 مشارکت

Pull Request‌ها خوش‌آمدند. برای ویژگی بزرگ، اول یک Issue باز کن. فورک‌کننده‌ها برای دیتابیس باید پروژهٔ Supabase خودشان را در `js/config.js` بگذارند.

## 🗺️ نقشهٔ راه

- [ ] مولتی‌پلیر آنلاین زنده (Realtime + نقش مخفی سروری)
- [ ] گردانندهٔ واقعی Claude از طریق Edge Function
- [ ] احراز هویت و پروفایل کامل
- [ ] چت صوتی زنده

## 📄 مجوز

[MIT](LICENSE)

</div>
