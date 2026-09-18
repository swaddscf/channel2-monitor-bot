# نشر مجاني يعمل 24/7 (Oracle Cloud Always Free)

هذا الدليل يشغّل البوت على جهاز افتراضي مجاني مدى الحياة من Oracle، مع Docker ووضع Polling، فلا تحتاج دوميناً ولا HTTPS.

> بديل أسهل لكنه قد ينام: Koyeb أو Render بالطبقة المجانية. إن أردت ضمان 24/7 بلا تكلفة فاتبع هذا الدليل.

## 1) أنشئ الحساب والجهاز

1. سجّل في <https://www.oracle.com/cloud/free/> واختر منطقة قريبة منك.
2. من القائمة: **Compute → Instances → Create instance**.
3. الإعدادات:
   - **Image**: Ubuntu 24.04.
   - **Shape**: Ampere (ARM) `VM.Standard.A1.Flex` — ضمن المجاني حتى **4 OCPU و24 GB RAM**؛ يكفي 1 OCPU و4 GB.
   - **Networking**: اترك VCN الافتراضي مع **Assign a public IPv4 address**.
   - **SSH keys**: نزّل المفتاح الخاص (`ssh-key-....key`).
4. أنشئ الجهاز وانتظر حتى تصبح الحالة **Running**، ثم انسخ **Public IP**.

لا تحتاج فتح أي منفذ إضافي: وضع Polling يتصل بتلغرام من داخل الجهاز. أبقِ منفذ SSH (22) فقط.

## 2) اتصل بالجهاز وثبّت Docker

من PowerShell على ويندوز (استبدل `IP` ومسار المفتاح):

```powershell
ssh -i "$env:USERPROFILE\Downloads\ssh-key.key" ubuntu@IP
```

ثم على الجهاز:

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2
sudo systemctl enable --now docker
sudo usermod -aG docker ubuntu
newgrp docker
docker --version && docker compose version
```

## 3) ارفع المشروع

من PowerShell على ويندوز، ارفع ملف ZIP (بعد استخراج أحدث نسخة):

```powershell
scp -i "$env:USERPROFILE\Downloads\ssh-key.key" `
  "$env:USERPROFILE\OneDrive\Desktop\ععععععععععععع\telegram-media-downloader-project.zip" `
  ubuntu@IP:~/
```

وعلى الجهاز:

```bash
sudo apt-get install -y unzip
unzip -o telegram-media-downloader-project.zip -d bot
cd bot
```

## 4) أنشئ ملف الأسرار

```bash
cp .env.production.example .env
nano .env
```

املأ `BOT_TOKEN` و`OWNER_ID` فقط، واترك `TELEGRAM_POLLING=1`. ثم:

```bash
chmod 600 .env
```

> لا ترفع `.env` إلى أي مستودع ولا تشاركه.

## 5) شغّل البوت

```bash
docker compose up -d --build
docker compose logs -f
```

ابحث عن:

```text
[Telegram polling] بدأ الاستعلام المحلي عبر getUpdates.
Server running on http://localhost:3000/
```

أرسل `/start` إلى البوت؛ ستظهر لوحة المالك الأساسي. للخروج من السجل: `Ctrl+C` (البوت يبقى يعمل).

## 6) البقاء بعد إعادة التشغيل

إعداداتنا `restart: unless-stopped` مع `systemctl enable docker`، لذلك يعمل البوت تلقائياً بعد كل إعادة تشغيل للجهاز. تحقق بـ:

```bash
docker compose ps
```

## 7) التحديث لاحقاً

```bash
cd ~/bot
docker compose down
# ارفع نسخة ZIP جديدة ثم:
unzip -o ~/telegram-media-downloader-project.zip -d ~/bot
docker compose up -d --build
```

لتحديث `yt-dlp` وحده دون إعادة بناء كامل:

```bash
docker compose exec bot pip3 install -U --break-system-packages yt-dlp
```

## استكشاف الأخطاء

| المشكلة | الحل |
| --- | --- |
| `getUpdates: Conflict` | يوجد Webhook أو نسخة أخرى تعمل. أوقف النسخ الأخرى، ووضعنا يحذف الـ Webhook تلقائياً. |
| البوت لا يرد | تحقق من `BOT_TOKEN`، ثم `docker compose logs -f`. |
| فشل التنزيل فقط | المنصة قد تحجب عنوان مركز البيانات، أو `yt-dlp` قديم. حدّثه ثم أعد المحاولة. |
| بطء/نفاد ذاكرة | استخدم مقاساً أكبر من Ampere ضمن المجاني (حتى 4 OCPU و24 GB). |

## العودة لوضع Webhook

عند حصولك على دومين لاحقاً: أزل `TELEGRAM_POLLING` من `.env`، أضف `TRUST_PROXY=1` و`WEBHOOK_URL`، ثم افتح الصفحة المنشورة مرة واحدة أو نفّذ `POST /api/telegram/activate` من نفس الدومين.
