# نشر مجاني على Render (من GitHub)

Render يبني صورة Docker من ملف `Dockerfile` (يثبّت `ffmpeg` و`yt-dlp` و`zip` تلقائياً)، ويشغّل البوت في وضع **Polling** بلا دومين ولا HTTPS. الإعداد جاهز في `render.yaml`.

> الطبقة المجانية من Render تُنيم الخدمة بعد ~15 دقيقة بلا زيارات HTTP. سنحلّها بمنبّه مجاني (الخطوة 5).

## 1) أنشئ مستودع GitHub وارفع المشروع

ثبّت Git for Windows أولاً إن لم يكن مثبتاً. من PowerShell داخل مجلد المشروع:

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\ععععععععععععع\telegram-media-downloader-project"
git init
git branch -M main
git config user.name "اسمك"
git config user.email "بريدك@example.com"
git add .
git commit -m "Initial deploy"
```

أنشئ المستودع من <https://github.com/new> (اجعله **Private**)، ثم:

```powershell
git remote add origin https://github.com/اسم-حسابك/telegram-media-downloader.git
git push -u origin main
```

عند أول `git push` ستفتح نافذة تسجيل دخول GitHub (Git Credential Manager) — سجّل الدخول واسمح.

> ملف `.gitignore` يستثني `.env`، لذا التوكن **لن** يُرفع. لا ترفعه يدوياً أبداً.

## 2) أنشئ الخدمة على Render

1. سجّل في <https://render.com> بحساب GitHub.
2. **New +** → **Blueprint**.
3. اختر المستودع الذي رفعته، ثم **Apply**. سيقرأ `render.yaml` تلقائياً.
4. سيطلب إدخال قيم المتغيرات السرّية:
   - `BOT_TOKEN` = توكن البوت من BotFather.
   - `OWNER_ID` = معرّفك الرقمي (مثال: `8694379643`).
5. اختر الخطة **Free** إن لم تُحدَّد، ثم **Create / Deploy**.

## 3) أول تشغيل

انتظر انتهاء البناء (عدة دقائق). ثم افتح:

- سجل البوت: **Dashboard → خدمتك → Logs**. ابحث عن:
  ```text
  [Telegram polling] بدأ الاستعلام المحلي عبر getUpdates.
  Server running on http://localhost:...
  ```
- الرابط العام: أعلى الصفحة، مثل `https://telegram-media-downloader-xxxx.onrender.com`.

أرسل `/start` إلى البوت على تلغرام؛ يجب أن يرد فوراً.

## 4) (إن لم تستخدم Blueprint) إنشاء خدمة يدوياً

- **New +** → **Web Service** → اختر المستودع.
- **Language/Runtime**: Docker.
- **Dockerfile Path**: `./Dockerfile`.
- **Plan**: Free.
- **Health Check Path**: `/`.
- **Environment Variables**: `NODE_ENV=production`، `TELEGRAM_POLLING=1`، `BOT_TOKEN`، `OWNER_ID`.
- أنشئ الخدمة.

## 5) منع النوم (مهم للعمل 24/7)

Render ينيم النسخة المجانية بعد خمود. الأنسب: منبّه خارجي يزور الرابط كل 10 دقائق.

- UptimeRobot: <https://uptimerobot.com> (مجاني).
  1. **Add New Monitor** → النوع **HTTP(s)**.
  2. الرابط = رابط خدمة Render.
  3. الفترة = **5 أو 10 دقائق**.
  4. احفظ.

هذا يبقى الخدمة مستيقظة ويجعلك متاحاً دائماً.

## 6) التحديث لاحقاً

أي `git push` جديد إلى `main` يُعيد النشر تلقائياً (`autoDeploy: true`).

لتحديث `yt-dlp` وحده:

```bash
# من Render → خدمتك → Shell (متاح في الخطط المدفوعة فقط)
pip3 install -U --break-system-packages yt-dlp
```

في الخطة المجانية، حدّثه برفع نسخة جديدة من الكود وإعادة النشر.

## ملاحظات مهمة

- الطبقة المجانية بذاكرة مؤقتة: المهام الجارية في الذاكرة تُفقد عند إعادة التشغيل/النوم — أعد إرسال الرابط عندها (البوت يعرض زر "أعد المحاولة").
- بعد النوم، أول رسالة قد تتأخر ~30 ثانية (بدء الخدمة).
- حدّ إرسال الوسائط عبر Bot API هو 50MB، لذلك يقيّد المشروع الملف بـ45MB لحماية الذاكرة وزمن الطلب.
- حدّث `ffmpeg`/`yt-dlp` من وقت لآخر؛ المنصات تتغيّر.

## استكشاف الأخطاء

| المشكلة | الحل |
| --- | --- |
| البوت لا يرد | تحقق من Logs، وتأكد أن `TELEGRAM_POLLING=1` و`BOT_TOKEN` صحيح. |
| البناء يفشل | افتح Logs وابحث عن خطأ `pnpm install`/`pnpm build`. |
| `getUpdates: Conflict` | نسخة أخرى تعمل (محلياً مثلاً). أوقفها. |
| فشل التنزيل فقط | المنصة تحجب عنوان مركز البيانات، أو `yt-dlp` قديم. |
| نوم متكرر | تأكد أن مراقب UptimeRobot يعمل كل 5–10 دقائق. |
