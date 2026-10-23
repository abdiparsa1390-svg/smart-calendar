import { useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, Eye, EyeOff, LockKeyhole, Mail, RefreshCw, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { API_AVAILABLE, apiFetch } from "./api.js";
import "./auth.css";

export default function AuthGate({ status, message, onMessage, onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const needsBackend = status === "backend-missing" || !API_AVAILABLE;

  async function submit(event) {
    event.preventDefault();
    if (busy || needsBackend) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await apiFetch(mode === "register" ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      if (mode === "register") {
        setNotice(data.message || "Check your inbox for a verification link.");
        setMode("login");
        setPassword("");
        return;
      }
      await onAuthenticated(data.user);
    } catch (requestError) {
      setError(requestError.message || "Something went wrong. Please try again.");
      if (mode === "login" && /verify your email/i.test(requestError.message)) {
        setNotice("Your account needs email verification.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification() {
    setBusy(true);
    setError("");
    try {
      const data = await apiFetch("/api/auth/resend-verification", {
        method: "POST",
        body: JSON.stringify({ email })
      });
      setNotice(data.message || "Check your inbox.");
    } catch (requestError) {
      setError(requestError.message || "Could not request another email.");
    } finally { setBusy(false); }
  }

  return (
    <main className="auth-shell">
      <section className="auth-visual">
        <div className="auth-visual-brand"><span className="auth-brand-icon"><CalendarDays size={21}/></span><span>smart<span>calendar</span></span></div>
        <div className="auth-visual-copy">
          <div className="auth-eyebrow"><Sparkles size={14}/> YOUR SPACE. YOUR SCHEDULE.</div>
          <h1>A calmer way to plan your time.</h1>
          <p>Your calendar, your AI provider, your preferences — all in one private workspace.</p>
          <div className="auth-feature-list">
            <div><CalendarDays size={18}/><span><strong>Your own calendar</strong><small>Keep your schedule in your account.</small></span></div>
            <div><LockKeyhole size={18}/><span><strong>Your own AI settings</strong><small>Use the provider and model you choose.</small></span></div>
            <div><ShieldCheck size={18}/><span><strong>Private by design</strong><small>Account data is separated on the server.</small></span></div>
          </div>
        </div>
        <div className="auth-visual-foot">SMART CALENDAR <span>·</span> PERSONAL PLANNING, REIMAGINED</div>
      </section>
      <section className="auth-side">
        <div className="auth-card">
          <div className="auth-mobile-brand"><span className="auth-brand-icon"><CalendarDays size={19}/></span> smart<span>calendar</span></div>
          {needsBackend ? (
            <div className="auth-blocked">
              <div className="auth-main-icon"><LockKeyhole size={23}/></div>
              <h2>Your private workspace is almost ready.</h2>
              <p>The site needs its account API server before sign-in, email verification, and per-user settings can work. GitHub Pages serves the website but cannot run this server by itself.</p>
              <div className="auth-check-list"><span><CheckCircle2 size={15}/> Account and verification API scaffolded</span><span><CheckCircle2 size={15}/> Per-user encrypted AI credentials</span><span><CheckCircle2 size={15}/> PostgreSQL-backed events</span></div>
              <a href="https://github.com/abdiparsa1390-svg/smart-calendar#readme" target="_blank" rel="noreferrer">Read server setup instructions <ArrowRight size={15}/></a>
            </div>
          ) : status === "checking" ? (
            <div className="auth-loading"><RefreshCw size={21} className="auth-spin"/><span>Checking your account…</span></div>
          ) : (
            <>
              <div className="auth-main-icon"><UserRound size={23}/></div>
              <p className="auth-kicker">{mode === "register" ? "START YOUR WORKSPACE" : "WELCOME BACK"}</p>
              <h2>{mode === "register" ? "Create your account" : "Sign in to Smart Calendar"}</h2>
              <p className="auth-subtitle">{mode === "register" ? "A few details, then check your inbox to verify your email." : "Your calendar and AI settings are saved to your account."}</p>
              {notice && <div className="auth-notice"><Mail size={16}/><span>{notice}</span></div>}
              {error && <div className="auth-error"><span>{error}</span></div>}
              <form className="auth-form" onSubmit={submit}>
                <label>Email address
                  <span className="auth-input-wrap"><Mail size={17}/><input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required maxLength={254}/></span>
                </label>
                <label>Password
                  <span className="auth-input-wrap"><LockKeyhole size={17}/><input type={passwordVisible ? "text" : "password"} autoComplete={mode === "register" ? "new-password" : "current-password"} value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === "register" ? "At least 10 characters" : "Enter your password"} minLength={mode === "register" ? 10 : 1} maxLength={200} required/><button type="button" className="auth-toggle-secret" onClick={() => setPasswordVisible(v => !v)} aria-label={passwordVisible ? "Hide password" : "Show password"}>{passwordVisible ? <EyeOff size={16}/> : <Eye size={16}/>}</button></span>
                </label>
                <button type="submit" className="auth-submit" disabled={busy}>{busy ? <><RefreshCw size={17} className="auth-spin"/> Please wait…</> : <>{mode === "register" ? "Create account" : "Sign in"} <ArrowRight size={17}/></>}</button>
              </form>
              {notice && mode === "login" && <button type="button" className="auth-resend" onClick={resendVerification} disabled={busy}>Didn't receive the email? Send a new link</button>}
              <div className="auth-switch">{mode === "register" ? <>Already have an account? <button onClick={() => { setMode("login"); setError(""); setNotice(""); }}>Sign in</button></> : <>New to Smart Calendar? <button onClick={() => { setMode("register"); setError(""); setNotice(""); }}>Create an account</button></>}</div>
              <p className="auth-legal"><ShieldCheck size={13}/> Your AI API key is stored encrypted on the account server.</p>
            </>
          )}
          {message && <p className="auth-global-message">{message}</p>}
          {onMessage && <span className="sr-only" aria-live="polite">{message || ""}</span>}
        </div>
      </section>
    </main>
  );
}
