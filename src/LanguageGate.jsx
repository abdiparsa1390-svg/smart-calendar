import { CalendarDays, LockKeyhole, ArrowRight, Globe2 } from "lucide-react";
import "./setup.css";

export default function LanguageGate({ onChoose }) {
  return <main className="setup-screen" lang="en">
    <section className="setup-card language-gate-card">
      <div className="setup-brand"><span className="setup-logo"><CalendarDays size={24}/></span><strong>Smart Calendar</strong><span className="setup-lock"><LockKeyhole size={14}/>Privacy-first setup</span></div>
      <div className="setup-progress"><span className="active"/></div>
      <div className="setup-stage">
        <div className="setup-icon"><Globe2 size={27}/></div>
        <p className="setup-eyebrow">WELCOME / خوش آمدی</p>
        <h1>Choose your language</h1>
        <p className="setup-subtitle">Choose the language you prefer. Setup and your AI planning partner will use it.</p>
        <div className="setup-language-options">
          <button type="button" onClick={() => onChoose("en")}><span>EN</span><strong>English</strong><ArrowRight size={18}/></button>
          <button type="button" onClick={() => onChoose("fa")} lang="fa" dir="rtl"><span>فا</span><strong>فارسی</strong><ArrowRight size={18}/></button>
        </div>
        <div className="setup-security"><LockKeyhole size={17}/><div><strong>Privacy & control</strong><p>You will connect Google, test your AI provider, and review the information before it is saved to memory.</p></div></div>
      </div>
    </section>
  </main>;
}
