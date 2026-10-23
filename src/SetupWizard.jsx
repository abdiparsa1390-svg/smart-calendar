import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Check, CircleHelp, FileText, Globe2, LockKeyhole, Plus, RefreshCw, ShieldCheck, Sparkles, Trash2, Zap } from "lucide-react";
import { apiFetch } from "./api.js";
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
import "./setup.css";

const newProvider = (index = 0) => ({
  id: crypto.randomUUID(), name: index ? `Backup ${index + 1}` : "Primary",
  baseUrl: index ? "" : "https://api.openai.com/v1", model: "", apiKey: "", proxyUrl: "", enabled: true
});
const labels = {
  en: {
    brand: "Smart Calendar", lock: "Privacy-first setup", step: "STEP", choose: "Choose your language",
    chooseSub: "The setup guide and your AI planning partner will use this language.",
    english: "English", persian: "فارسی (Persian)", next: "Continue", back: "Back",
    googleTitle: "Connect your Google Calendar", googleSub: "This is required before using the calendar. Smart Calendar will read and create events only with your permission.",
    connectGoogle: "Connect Google account", connected: "Google Calendar connected", needGoogle: "Connect Google Calendar to continue.",
    noClient: "The app owner must configure a valid Google OAuth Client ID before Google connection can work. This is not a problem with your Google account.",
    aiTitle: "Connect and test your AI", aiSub: "Add at least one OpenAI-compatible provider. A backup is tried automatically when a provider is rate-limited or unavailable.",
    provider: "Provider", name: "Name", base: "Base URL", model: "Model ID", key: "API key", proxy: "Optional HTTP/HTTPS proxy URL",
    addProvider: "Add backup provider", remove: "Remove", test: "Test all providers & save", testing: "Testing each provider…",
    saved: "AI connection tested and settings saved.", security: "Keys are encrypted before being stored by the local app or account server. Never share your API keys.",
    interviewTitle: "Let’s get to know you", interviewSub: "Your AI planning partner will ask about your goals, routines, constraints, and preferences. Nothing is saved to memory until you approve the summary.",
    startInterview: "Start conversation", send: "Send", writeHere: "Write your answer…", createSummary: "Review my memory summary",
    summaryTitle: "Review your personal memory", summarySub: "These Markdown files will help the AI make better plans. Review them, then explicitly approve saving.",
    approve: "Approve and save memory", preparing: "Preparing summary…", done: "Complete setup", finish: "Your private planning workspace is ready",
    finalSub: "Your AI will now plan in your chosen language. Suggested calendar changes will always wait for your approval.",
    working: "Please wait…", retry: "Try again", lockTitle: "Security and privacy",
    lockBody: "Your AI key is encrypted at rest. Google access is held in memory for this session. Calendar changes require your approval.",
    memoryError: "Could not create the memory summary. Please try again."
  },
  fa: {
    brand: "تقویم هوشمند", lock: "راه‌اندازی با اولویت حریم خصوصی", step: "مرحله", choose: "زبان خودت را انتخاب کن",
    chooseSub: "راهنمای نصب و گفت‌وگوی هوش مصنوعی با این زبان انجام می‌شود.",
    english: "English", persian: "فارسی", next: "ادامه", back: "بازگشت",
    googleTitle: "اتصال تقویم گوگل", googleSub: "برای استفاده از تقویم، اتصال حساب گوگل اجباری است. برنامه فقط با اجازهٔ تو رویدادها را می‌خواند و ایجاد می‌کند.",
    connectGoogle: "اتصال حساب گوگل", connected: "تقویم گوگل متصل شد", needGoogle: "برای ادامه باید تقویم گوگل را متصل کنی.",
    noClient: "مالک برنامه باید شناسهٔ معتبر Google OAuth را تنظیم کند. این خطا مربوط به حساب گوگل تو نیست.",
    aiTitle: "اتصال و آزمایش هوش مصنوعی", aiSub: "حداقل یک ارائه‌دهندهٔ سازگار با OpenAI وارد کن. اگر به محدودیت یا خطا بخورد، برنامه به‌ترتیب سراغ ارائه‌دهندهٔ پشتیبان می‌رود.",
    provider: "ارائه‌دهنده", name: "نام", base: "آدرس پایه", model: "شناسهٔ مدل", key: "کلید API", proxy: "آدرس پروکسی HTTP/HTTPS (اختیاری)",
    addProvider: "افزودن API پشتیبان", remove: "حذف", test: "آزمایش همه و ذخیره", testing: "در حال آزمایش ارائه‌دهنده‌ها…",
    saved: "اتصال هوش مصنوعی آزمایش و تنظیمات ذخیره شد.", security: "کلیدها پیش از ذخیره‌سازی در برنامهٔ محلی یا سرور حساب رمزگذاری می‌شوند. کلید API را با کسی به اشتراک نگذار.",
    interviewTitle: "بیا با هم آشنا شویم", interviewSub: "هوش مصنوعی دربارهٔ هدف‌ها، عادت‌ها، محدودیت‌ها و ترجیحاتت سؤال می‌پرسد. اطلاعات تا وقتی خلاصه را تأیید نکنی در حافظه ذخیره نمی‌شود.",
    startInterview: "شروع گفت‌وگو", send: "ارسال", writeHere: "پاسخت را بنویس…", createSummary: "مرور خلاصهٔ حافظه",
    summaryTitle: "حافظهٔ شخصی را مرور کن", summarySub: "این فایل‌های Markdown به هوش مصنوعی کمک می‌کنند برنامه‌ریزی دقیق‌تری انجام دهد. پس از بررسی، ذخیره را تأیید کن.",
    approve: "تأیید و ذخیرهٔ حافظه", preparing: "در حال آماده‌سازی خلاصه…", done: "پایان راه‌اندازی", finish: "فضای برنامه‌ریزی شخصی آماده است",
    finalSub: "از این به بعد هوش مصنوعی به زبان انتخابی‌ات برنامه‌ریزی می‌کند. تغییرات تقویم همیشه منتظر تأیید تو می‌مانند.",
    working: "کمی صبر کن…", retry: "تلاش دوباره", lockTitle: "امنیت و حریم خصوصی",
    lockBody: "کلید هوش مصنوعی در حالت ذخیره رمزگذاری شده است. دسترسی گوگل فقط در حافظهٔ همین نشست نگه داشته می‌شود. تغییرات تقویم نیازمند تأیید تو هستند.",
    memoryError: "ساخت خلاصهٔ حافظه ناموفق بود. دوباره تلاش کن."
  }
};
const memoryFiles = ["profile.md", "goals.md", "preferences.md", "routines.md", "planning.md"];

export default function SetupWizard({
  accessToken, googleVerified, googleError, googleSdkReady, startGoogleConnect, initialSetupComplete,
  onComplete, onResume
}) {
  const savedLanguage = (() => { try { return localStorage.getItem("smart-calendar-language") || ""; } catch { return ""; } })();
  const [language, setLanguage] = useState(savedLanguage);
  const t = labels[language || "en"];
  const [stage, setStage] = useState(savedLanguage ? 1 : 0);
  const [providers, setProviders] = useState([newProvider()]);
  const [savingAI, setSavingAI] = useState(false);
  const [aiTested, setAiTested] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [memoryPreview, setMemoryPreview] = useState(null);
  const [memoryApproved, setMemoryApproved] = useState(false);
  const [completed, setCompleted] = useState(false);
  const interviewAnswers = useMemo(() => messages.filter(m => m.role === "user" && !m.hidden).length, [messages]);

  useEffect(() => {
    if (initialSetupComplete && accessToken) onResume?.();
  }, [initialSetupComplete, accessToken]);

  useEffect(() => {
    if (!language || initialSetupComplete) return;
    let active = true;
    apiFetch("/api/ai/settings").then(data => {
      if (!active || !Array.isArray(data.providers) || !data.providers.length) return;
      setProviders(data.providers.map((provider, i) => ({
        id: provider.id || crypto.randomUUID(), name: provider.name || (i ? `Backup ${i + 1}` : "Primary"),
        baseUrl: provider.baseUrl || "", model: provider.model || "", apiKey: "", proxyUrl: provider.proxyUrl || "", enabled: provider.enabled !== false, apiKeyConfigured: Boolean(provider.apiKeyConfigured)
      })));
    }).catch(() => {});
    return () => { active = false; };
  }, [language, initialSetupComplete]);

  function chooseLanguage(value) {
    setLanguage(value);
    try { localStorage.setItem("smart-calendar-language", value); } catch {}
    setStage(1);
  }
  function patchProvider(id, patch) {
    setProviders(previous => previous.map(p => p.id === id ? { ...p, ...patch } : p));
    setAiTested(false);
    setNotice("");
  }
  function providerPayload() {
    return providers.map((p, i) => ({
      ...p, name: p.name.trim() || (i ? `Backup ${i + 1}` : "Primary"),
      baseUrl: p.baseUrl.trim(), model: p.model.trim(), apiKey: p.apiKey.trim(),
      proxyUrl: p.proxyUrl.trim(), enabled: p.enabled !== false
    })).filter(p => p.enabled);
  }
  async function testAndSaveAI() {
    const list = providerPayload();
    if (!list.length || list.some(p => !p.baseUrl || !p.model || (!p.apiKey && !p.apiKeyConfigured))) {
      setError(language === "fa" ? "برای هر ارائه‌دهندهٔ فعال، آدرس پایه، مدل و کلید API لازم است." : "Each enabled provider needs a Base URL, model, and API key.");
      return;
    }
    setSavingAI(true); setError(""); setNotice("");
    try {
      const test = await apiFetch("/api/ai/test", { method: "POST", body: JSON.stringify({ providers: list, fallbackEnabled: true }) });
      if (!test.ok) throw new Error(test.message || "The connection test failed.");
      const saved = await apiFetch("/api/ai/settings", { method: "PUT", body: JSON.stringify({ providers: list, fallbackEnabled: true }) });
      setAiTested(true);
      setNotice((language === "fa" ? "اتصال موفق بود. ارائه‌دهندهٔ فعال: " : "Connection successful. Active provider: ") + (test.providerName || list[0].name));
      onComplete?.({ action: "ai-saved", language, settings: saved });
      setStage(3);
      await beginInterview();
    } catch (e) {
      setError(e.message || (language === "fa" ? "اتصال هوش مصنوعی ناموفق بود." : "The AI connection test failed."));
    } finally { setSavingAI(false); }
  }
  const interviewSystem = language === "fa"
    ? "تو دستیار صمیمی برنامه‌ریزی Smart Calendar هستی. فقط فارسی صحبت کن. در مصاحبهٔ شروع کار، در هر پیام فقط یک سؤال روشن و کوتاه بپرس. به جواب کاربر واکنش انسانی و دقیق نشان بده و به‌ترتیب دربارهٔ هدف‌های کوتاه‌مدت و بلندمدت، درس/کار، تعهدات ثابت، انرژی و خواب، محدودیت‌ها، ترجیحات برنامه‌ریزی، استراحت و تفریح، و نحوهٔ یادآوری سؤال بپرس. سؤال تکراری نپرس؛ از اطلاعات گفته‌شده استفاده کن. تقویم را تغییر نده و ادعای ذخیره‌سازی نکن. وقتی اطلاعات کافی شد، بگو می‌تواند دکمهٔ مرور خلاصهٔ حافظه را بزند."
    : "You are the warm planning partner inside Smart Calendar. Speak only English. During first-run onboarding, ask one clear question per reply. React thoughtfully to the user's answer, then ask about short/long-term goals, study/work, fixed commitments, sleep/energy, constraints, planning preferences, rest/play, and reminders. Do not repeat answered questions. Do not change calendar events or claim to have saved memory. Once there is enough information, tell the user they can review the memory summary.";
  async function callInterview(history, userPrompt) {
    const data = await apiFetch("/api/ai/chat", {
      method: "POST",
      body: JSON.stringify({ messages: [
        { role: "system", content: interviewSystem },
        ...(userPrompt ? [{ role: "user", content: userPrompt }] : []),
        ...history.filter(m => !m.hidden).map(m => ({ role: m.role, content: m.content }))
      ] })
    });
    if (!data.content) throw new Error("The AI provider returned no assistant message.");
    return typeof data.content === "string" ? data.content : JSON.stringify(data.content);
  }
  async function beginInterview() {
    setChatBusy(true); setError("");
    const kickoff = language === "fa" ? "به گفت‌وگوی آشنایی خوش آمدی. خودت را معرفی کن و اولین سؤال مناسب را بپرس." : "Welcome the user and begin the getting-to-know-you interview with the first useful question.";
    try {
      const answer = await callInterview([], kickoff);
      setMessages([{ id: crypto.randomUUID(), role: "assistant", content: answer }]);
    } catch (e) {
      setError(e.message || "Could not start the interview.");
      setMessages([{ id: crypto.randomUUID(), role: "assistant", content: language === "fa" ? "سلام! برای شروع، مهم‌ترین هدفی که دوست داری در چند ماه آینده به آن برسی چیست؟" : "Hi! To start, what is the most important goal you'd like to reach in the next few months?" }]);
    } finally { setChatBusy(false); }
  }
  async function sendInterviewMessage(e) {
    e?.preventDefault();
    const content = chatInput.trim();
    if (!content || chatBusy) return;
    const userMessage = { id: crypto.randomUUID(), role: "user", content };
    const history = [...messages, userMessage];
    setMessages(history); setChatInput(""); setChatBusy(true); setError("");
    try {
      const answer = await callInterview(history, "");
      setMessages(previous => [...previous, { id: crypto.randomUUID(), role: "assistant", content: answer }]);
    } catch (e) {
      setError(e.message || (language === "fa" ? "پاسخ هوش مصنوعی دریافت نشد." : "The assistant reply failed."));
    } finally { setChatBusy(false); }
  }
  async function makeMemorySummary() {
    setSummaryBusy(true); setError(""); setMemoryApproved(false);
    const prompt = language === "fa"
      ? "از مصاحبهٔ زیر فقط اطلاعاتی را که کاربر صریحاً گفته استخراج کن. یک شیء JSON معتبر و بدون توضیح یا Markdown code fence برگردان که دقیقاً پنج کلید profile.md، goals.md، preferences.md، routines.md و planning.md داشته باشد. مقدار هر کلید متن Markdown به فارسی باشد؛ اگر اطلاعاتی نداری، بنویس '# هنوز مشخص نشده'. هیچ واقعیتی نساز، کلید خصوصی یا اطلاعات حساس غیرضروری ذخیره نکن و فقط مواردی را وارد کن که برای برنامه‌ریزی مفید هستند. گفتگو: "
      : "Extract only facts the user explicitly shared in this interview. Return one valid JSON object and no explanation/code fence, with exactly five keys: profile.md, goals.md, preferences.md, routines.md, planning.md. Each value must be useful English Markdown. If unknown, write '# Not provided yet'. Do not invent facts and do not include unnecessary sensitive information or secrets. Interview transcript: ";
    try {
      const response = await apiFetch("/api/ai/chat", { method: "POST", body: JSON.stringify({ messages: [
        { role: "system", content: "You create concise user-approved planning memory files. Follow the requested JSON format exactly." },
        { role: "user", content: prompt + messages.map(m => (m.role === "user" ? "User: " : "Assistant: ") + m.content).join("\n\n") }
      ] }) });
      let raw = String(response.content || "").trim().replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/, "");
      const parsed = JSON.parse(raw);
      const result = Object.fromEntries(memoryFiles.map(name => [name, String(parsed[name] || (language === "fa" ? "# هنوز مشخص نشده" : "# Not provided yet"))]));
      setMemoryPreview(result);
    } catch (e) {
      setError((e.message || t.memoryError) + " — " + t.memoryError);
    } finally { setSummaryBusy(false); }
  }
  async function approveMemory() {
    if (!memoryPreview || !memoryApproved) return;
    setSavingAI(true); setError("");
    try {
      await apiFetch("/api/memory", { method: "PUT", body: JSON.stringify({ files: memoryPreview }) });
      setCompleted(true); setStage(5);
    } catch (e) {
      setError(e.message || "Could not save the memory files.");
    } finally { setSavingAI(false); }
  }
  function completeSetup() {
    const readyProviders = providerPayload().map(p => ({ ...p, apiKey: "" }));
    const primary = providers[0] || newProvider();
    try {
      localStorage.setItem("smart-calendar-language", language);
      localStorage.setItem("smart-calendar-setup-complete", "yes");
      localStorage.setItem("smart-calendar-setup-v2", JSON.stringify({ complete: true, language, at: new Date().toISOString() }));
      localStorage.setItem("smart-calendar-onboarding-done", "yes");
    } catch {}
    onComplete?.({
      action: "complete", language,
      config: { baseUrl: primary.baseUrl || "https://api.openai.com/v1", model: primary.model || "", apiKey: "", providers: readyProviders },
      messages: messages.filter(m => !m.hidden),
      memoryFiles: memoryPreview
    });
  }

  if (initialSetupComplete && !accessToken) {
    return <main className="setup-screen" lang={language || "en"} dir={language === "fa" ? "rtl" : "ltr"}>
      <section className="setup-card">
        <div className="setup-brand"><span className="setup-logo"><CalendarDays size={24}/></span><strong>{t.brand}</strong><span className="setup-lock"><LockKeyhole size={14}/>{t.lock}</span></div>
        <div className="setup-icon"><CalendarDays size={27}/></div><p className="setup-eyebrow">{t.step} 1 / 1</p><h1>{t.googleTitle}</h1><p className="setup-subtitle">{t.needGoogle}</p>
        {googleError && <div className="setup-error"><CircleHelp size={17}/>{googleError}</div>}
        <button type="button" className="setup-primary" onClick={startGoogleConnect} disabled={!googleSdkReady}><CalendarDays size={17}/>{googleSdkReady ? t.connectGoogle : t.working}</button>
        <div className="setup-security"><ShieldCheck size={17}/><div><strong>{t.lockTitle}</strong><p>{t.lockBody}</p></div></div>
      </section>
    </main>;
  }

  return <main className="setup-screen" lang={language || "en"} dir={language === "fa" ? "rtl" : "ltr"}>
    <section className="setup-card">
      <div className="setup-brand"><span className="setup-logo"><CalendarDays size={24}/></span><strong>{t.brand}</strong><span className="setup-lock"><LockKeyhole size={14}/>{t.lock}</span></div>
      <div className="setup-progress">{[0,1,2,3,4].map(n => <span key={n} className={stage >= n ? "active" : ""}/>)}</div>
      {stage === 0 && <div className="setup-stage">
        <div className="setup-icon"><Globe2 size={27}/></div><p className="setup-eyebrow">WELCOME / خوش آمدی</p><h1>{t.choose}</h1><p className="setup-subtitle">{t.chooseSub}</p>
        <div className="setup-language-options"><button type="button" onClick={() => chooseLanguage("en")}><span>EN</span><strong>{labels.en.english}</strong><ArrowRight size={18}/></button><button type="button" onClick={() => chooseLanguage("fa")}><span>فا</span><strong>{labels.fa.persian}</strong><ArrowLeft size={18}/></button></div>
      </div>}
      {stage === 1 && <div className="setup-stage">
        <div className="setup-icon"><CalendarDays size={27}/></div><p className="setup-eyebrow">{t.step} 1 / 3</p><h1>{t.googleTitle}</h1><p className="setup-subtitle">{t.googleSub}</p>
        <div className={"setup-check-row " + (googleVerified ? "ready" : "")}><span className="setup-check">{googleVerified ? <Check size={18}/> : <CalendarDays size={18}/>}</span><div><strong>{googleVerified ? t.connected : (accessToken ? (language === "fa" ? "در حال بررسی دسترسی به تقویم گوگل…" : "Verifying Google Calendar access…") : t.needGoogle)}</strong><p>{googleVerified ? (language === "fa" ? "اتصال گوگل در این نشست تأیید شد." : "Google Calendar access was verified for this session.") : (language === "fa" ? "پنجرهٔ رسمی مجوز گوگل باز می‌شود؛ سپس دسترسی تقویم بررسی می‌شود." : "Authorize with Google; the app will then verify Calendar API access.")}</p></div></div>
        {googleError && <div className="setup-error"><CircleHelp size={17}/><span>{googleError}{!accessToken && !String(googleError).includes("cancel") && !GOOGLE_CLIENT_ID ? " " + t.noClient : ""}</span></div>}
        <div className="setup-actions"><button type="button" className="setup-secondary" onClick={() => setStage(0)}><ArrowLeft size={16}/>{t.back}</button><button type="button" className="setup-secondary" onClick={startGoogleConnect} disabled={!googleSdkReady || Boolean(accessToken)}><CalendarDays size={16}/>{accessToken ? t.connected : t.connectGoogle}</button><button type="button" className="setup-primary" onClick={() => setStage(2)} disabled={!googleVerified}>{t.next}<ArrowRight size={16}/></button></div>
      </div>}
      {stage === 2 && <div className="setup-stage">
        <div className="setup-icon"><Sparkles size={27}/></div><p className="setup-eyebrow">{t.step} 2 / 3</p><h1>{t.aiTitle}</h1><p className="setup-subtitle">{t.aiSub}</p>
        <div className="setup-provider-list">
          {providers.map((p, i) => <section className="setup-provider" key={p.id}>
            <div className="setup-provider-heading"><strong>{t.provider} {i + 1}</strong>{i > 0 && <button type="button" className="setup-remove" onClick={() => setProviders(old => old.filter(x => x.id !== p.id))}><Trash2 size={14}/>{t.remove}</button>}</div>
            <label>{t.name}<input value={p.name} onChange={e => patchProvider(p.id, { name: e.target.value })} required /></label>
            <label>{t.base}<input value={p.baseUrl} onChange={e => patchProvider(p.id, { baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" type="url" required /></label>
            <label>{t.model}<input value={p.model} onChange={e => patchProvider(p.id, { model: e.target.value })} placeholder="e.g. gpt-4o-mini" required /></label>
            <label>{t.key}<input value={p.apiKey} onChange={e => patchProvider(p.id, { apiKey: e.target.value })} placeholder={p.apiKeyConfigured ? (language === "fa" ? "برای حفظ کلید قبلی خالی بگذار" : "Leave empty to keep saved key") : (language === "fa" ? "کلید API" : "Paste API key")} type="password" autoComplete="new-password" required={!p.apiKeyConfigured}/></label>
            <label>{t.proxy}<input value={p.proxyUrl} onChange={e => patchProvider(p.id, { proxyUrl: e.target.value })} placeholder="http://127.0.0.1:7890" type="url" /></label>
          </section>)}
        </div>
        <button type="button" className="setup-add-provider" onClick={() => setProviders(old => [...old, newProvider(old.length)])}><Plus size={16}/>{t.addProvider}</button>
        {notice && <div className="setup-success"><Check size={17}/>{notice}</div>}
        {error && <div className="setup-error"><CircleHelp size={17}/>{error}</div>}
        <div className="setup-security"><ShieldCheck size={17}/><div><strong>{t.lockTitle}</strong><p>{t.security}</p></div></div>
        <div className="setup-actions"><button type="button" className="setup-secondary" onClick={() => setStage(1)}><ArrowLeft size={16}/>{t.back}</button><button type="button" className="setup-primary" onClick={testAndSaveAI} disabled={savingAI}>{savingAI ? <><RefreshCw size={16} className="setup-spin"/>{t.testing}</> : <><Zap size={16}/>{t.test}</>}</button></div>
      </div>}
      {stage === 3 && <div className="setup-stage setup-interview">
        <div className="setup-icon"><Sparkles size={27}/></div><p className="setup-eyebrow">{t.step} 3 / 3</p><h1>{t.interviewTitle}</h1><p className="setup-subtitle">{t.interviewSub}</p>
        <div className="setup-interview-chat">
          {messages.filter(m => !m.hidden).map(m => <div className={"setup-chat-message " + (m.role === "user" ? "from-user" : "")} key={m.id}><span>{m.role === "user" ? (language === "fa" ? "تو" : "You") : "✦ AI"}</span><p>{m.content}</p></div>)}
          {chatBusy && <div className="setup-typing"><i/><i/><i/></div>}
        </div>
        <form className="setup-chat-form" onSubmit={sendInterviewMessage}><textarea value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder={t.writeHere} rows={2} disabled={chatBusy}/><button className="setup-primary" type="submit" disabled={!chatInput.trim() || chatBusy}>{chatBusy ? <RefreshCw size={16} className="setup-spin"/> : <ArrowRight size={16}/>} {t.send}</button></form>
        <div className="setup-interview-actions"><span>{language === "fa" ? `${interviewAnswers} پاسخ ثبت‌شده` : `${interviewAnswers} answers shared`}</span><button type="button" className="setup-primary" onClick={makeMemorySummary} disabled={summaryBusy || interviewAnswers < 1}>{summaryBusy ? <><RefreshCw size={16} className="setup-spin"/>{t.preparing}</> : <><FileText size={16}/>{t.createSummary}</>}</button></div>
        {error && <div className="setup-error"><CircleHelp size={17}/>{error}</div>}
      </div>}
      {stage === 4 && memoryPreview && !completed && <div className="setup-stage">
        <div className="setup-icon"><FileText size={27}/></div><p className="setup-eyebrow">{t.step} 4 / 4</p><h1>{t.summaryTitle}</h1><p className="setup-subtitle">{t.summarySub}</p>
        <div className="setup-memory-files">{memoryFiles.map(name => <article key={name}><strong><FileText size={15}/>{name}</strong><pre>{memoryPreview[name]}</pre></article>)}</div>
        <label className="setup-approve"><input type="checkbox" checked={memoryApproved} onChange={e => setMemoryApproved(e.target.checked)}/><span>{language === "fa" ? "این اطلاعات را بررسی کردم و ذخیرهٔ آن‌ها در حافظهٔ شخصی را تأیید می‌کنم." : "I reviewed these details and approve saving them to my personal memory."}</span></label>
        {error && <div className="setup-error"><CircleHelp size={17}/>{error}</div>}
        <div className="setup-actions"><button type="button" className="setup-secondary" onClick={() => setStage(3)}><ArrowLeft size={16}/>{t.back}</button><button type="button" className="setup-primary" onClick={approveMemory} disabled={!memoryApproved || savingAI}>{savingAI ? <RefreshCw size={16} className="setup-spin"/> : <Check size={16}/>} {t.approve}</button></div>
      </div>}
      {completed && stage === 5 && <div className="setup-finish"><div className="setup-finish-icon"><Check size={30}/></div><h2>{t.finish}</h2><p>{t.finalSub}</p><button type="button" className="setup-primary" onClick={completeSetup}>{t.done}<ArrowRight size={17}/></button></div>}
      <div className="setup-bottom"><ShieldCheck size={14}/><span>{t.lockBody}</span></div>
    </section>
    <div className="setup-footnote">{t.lockTitle} · Smart Calendar</div>
  </main>;
}
