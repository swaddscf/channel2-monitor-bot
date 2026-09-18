import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Link2, LockKeyhole, MessageCircle, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

/**
 * All content in this page are only for example, replace with your own feature implementation
 * When building pages, remember your instructions in Frontend Workflow, Frontend Best Practices, Design Guide and Common Pitfalls
 */
export default function Home() {
  const { data: status, isLoading } = trpc.telegram.status.useQuery(undefined, { refetchInterval: 30_000 });
  const [activation, setActivation] = useState<"idle" | "working" | "waiting" | "done" | "failed">("idle");
  const readyToActivate = Boolean(status?.tokenConfigured && status.ownerConfigured && status.webhookSecretConfigured);
  useEffect(() => {
    if (import.meta.env.DEV || !readyToActivate) return;
    let cancelled = false;
    let retryTimer: number | undefined;
    const activate = async () => {
      if (cancelled) return;
      setActivation("working");
      try {
        const response = await fetch("/api/telegram/activate", { method: "POST", headers: { "X-Telegram-Activation": "1" } });
        const result = await response.json().catch(() => ({})) as { retryAfterSeconds?: number };
        if (response.status === 429 && result.retryAfterSeconds) {
          setActivation("waiting");
          retryTimer = window.setTimeout(activate, Math.min(result.retryAfterSeconds + 1, 65) * 1000);
          return;
        }
        if (!response.ok) throw new Error("activation failed");
        setActivation("done");
      } catch {
        if (!cancelled) setActivation("failed");
      }
    };
    void activate();
    return () => { cancelled = true; if (retryTimer) window.clearTimeout(retryTimer); };
  }, [readyToActivate]);
  const checks = [
    { label: "توكن البوت", done: status?.tokenConfigured },
    { label: "معرّف المالك الأساسي", done: status?.ownerConfigured },
    { label: "سر حماية Webhook", done: status?.webhookSecretConfigured },
    { label: "رابط Webhook العام", done: status?.webhookActive || activation === "done" },
  ];

  return (
    <div dir="rtl" className="min-h-screen bg-slate-950 text-slate-100">
      <main className="mx-auto flex min-h-screen max-w-5xl items-center px-5 py-12">
        <div className="grid w-full gap-8 lg:grid-cols-[1.25fr_.75fr]">
          <section className="rounded-[2rem] border border-slate-700/60 bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950 p-8 shadow-2xl shadow-indigo-950/30 md:p-12">
            <Badge className="mb-6 bg-indigo-400/15 px-3 py-1 text-indigo-200 hover:bg-indigo-400/15">نقطة الربط الآمنة</Badge>
            <div className="mb-6 flex size-14 items-center justify-center rounded-2xl bg-indigo-400 text-slate-950 shadow-lg shadow-indigo-400/20"><MessageCircle className="size-7" /></div>
            <h1 className="max-w-xl text-4xl font-bold leading-tight tracking-tight md:text-5xl">بوت تنزيل الوسائط<br /><span className="text-indigo-300">جاهز للربط الآمن</span></h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-slate-300">هذه الصفحة لا تحتوي على لوحة إدارة ولا تجمع بيانات المستخدمين. إدارة البوت والملاك والمستخدمين تتم حصرياً من أزرار تلغرام التي يراها المالك الأساسي.</p>
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {[
                [ShieldCheck, "محتوى عام فقط"],
                [LockKeyhole, "لا أسرار داخل الكود"],
                [Link2, "Webhook محمي برمز سري"],
                [CheckCircle2, "ملفات مؤقتة تُحذف بعد الإرسال"],
              ].map(([Icon, label]) => {
                const IconComponent = Icon as typeof ShieldCheck;
                return <div key={String(label)} className="flex items-center gap-3 rounded-xl border border-slate-700/50 bg-slate-950/30 px-4 py-3 text-sm text-slate-200"><IconComponent className="size-4 text-indigo-300" />{String(label)}</div>;
              })}
            </div>
          </section>

          <Card className="border-slate-700/60 bg-slate-900 text-slate-100 shadow-xl shadow-black/20">
              <CardHeader className="border-b border-slate-800 pb-5"><CardTitle className="text-xl">حالة التكامل</CardTitle><p className="text-sm font-normal leading-6 text-slate-400">بعد النشر، يشتق البوت حماية Webhook ويُكمل الربط تلقائياً من هذه الصفحة؛ لا توجد أسرار إضافية لإدخالها.</p></CardHeader>
            <CardContent className="space-y-4 pt-6">
              {checks.map(check => <div key={check.label} className="flex items-center justify-between rounded-xl bg-slate-950/50 px-4 py-3"><span className="text-sm">{check.label}</span><Badge className={check.done ? "bg-emerald-400/15 text-emerald-300 hover:bg-emerald-400/15" : "bg-amber-400/15 text-amber-200 hover:bg-amber-400/15"}>{isLoading ? "جارٍ الفحص" : check.done ? "مُعد" : "بانتظار الإعداد"}</Badge></div>)}
              <div className="rounded-xl border border-indigo-400/15 bg-indigo-400/5 p-4 text-xs leading-6 text-indigo-100">المسار المحمي: <code className="font-mono text-indigo-200">{status?.webhookPath || "/api/telegram/webhook"}</code></div>
              {activation !== "idle" && <p className={activation === "done" ? "text-xs text-emerald-300" : activation === "failed" ? "text-xs text-amber-200" : "text-xs text-indigo-200"}>{activation === "working" ? "جارٍ تفعيل Webhook الآمن…" : activation === "waiting" ? "Telegram يحدّث الربط؛ سيعيد البوت المحاولة تلقائياً خلال دقيقة." : activation === "done" ? "تم تفعيل Webhook بنجاح." : "تعذر التفعيل الآن؛ أعد فتح الصفحة المنشورة بعد لحظات."}</p>}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
