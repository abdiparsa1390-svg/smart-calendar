import { useEffect, useMemo, useRef, useState } from "react";
import "./enhancements.css";
import AuthGate from "./AuthGate.jsx";
import SetupWizard from "./SetupWizard.jsx";
import LanguageGate from "./LanguageGate.jsx";
import { API_AVAILABLE, LOCAL_MODE, apiFetch } from "./api.js";
import {
  ArrowRight, Bot, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight,
  CircleHelp, Clock3, Eye, EyeOff, ListTodo, MessageSquare, MoreHorizontal, LockKeyhole, FileText,
  Plus, RefreshCw, Send, Settings2, ShieldCheck, Sparkles, X, Zap
} from "lucide-react";

const HOURS = Array.from({ length: 13 }, (_, i) => i + 7);
const EVENTS_KEY = "smart-calendar-events-v1";
const COLORS = ["#6d72d9", "#24a79b", "#e39c4c", "#de718d", "#6298dd"];
const blankConfig = { baseUrl: "https://api.openai.com/v1", apiKey: "", model: "", proxyUrl: "", providers: [] };
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.events";
function googleEventToAppEvent(item) {
  const allDay = Boolean(item.start?.date && !item.start?.dateTime);
  const start = item.start?.dateTime ? new Date(item.start.dateTime) : new Date((item.start?.date || dayKey(new Date())) + "T00:00:00");
  const end = item.end?.dateTime ? new Date(item.end.dateTime) : new Date((item.end?.date || item.start?.date || dayKey(new Date())) + "T00:00:00");
  const repeat = item.recurrence?.[0]?.match(/FREQ=([^;]+)/i)?.[1]?.toLowerCase() || "none";
  const reminder = item.reminders?.useDefault ? "" : (item.reminders?.overrides || []).find(r => r.method === "popup")?.minutes ?? "";
  return {
    id: item.id, googleId: item.id, source: "google", title: item.summary || "Untitled event",
    start, end, color: COLORS[1], place: item.description || "", location: item.location || "",
    allDay, reminderMinutes: reminder, recurrence: repeat, googleUrl: item.htmlLink || ""
  };
}
function googlePayloadFromDraft(draft, start, end) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let startValue, endValue;
  if (draft.allDay) {
    const exclusiveEnd = new Date(start);
    exclusiveEnd.setDate(exclusiveEnd.getDate() + 1);
    startValue = { date: dayKey(start) };
    endValue = { date: dayKey(exclusiveEnd) };
  } else {
    startValue = { dateTime: start.toISOString(), timeZone: timezone };
    endValue = { dateTime: end.toISOString(), timeZone: timezone };
  }
  const payload = {
    summary: draft.title.trim(), description: draft.place || "", location: draft.location || "",
    start: startValue, end: endValue,
    reminders: draft.reminderMinutes === "" || draft.reminderMinutes == null
      ? { useDefault: true }
      : { useDefault: false, overrides: [{ method: "popup", minutes: Number(draft.reminderMinutes) }] }
  };
  if (draft.recurrence && draft.recurrence !== "none") payload.recurrence = ["RRULE:FREQ=" + String(draft.recurrence).toUpperCase()];
  return payload;
}
function loadGoogleIdentityScript() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let script = document.getElementById("google-identity-script");
    if (script) {
      script.addEventListener("load", resolve, { once: true });
      script.addEventListener("error", () => reject(new Error("Could not load Google's authorization library. Check your internet connection.")), { once: true });
      return;
    }
    script = document.createElement("script");
    script.id = "google-identity-script";
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Could not load Google's authorization library. Check your internet connection."));
    document.head.appendChild(script);
  });
}

function loadConfig() {
  return blankConfig;
}
function dayKey(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}
function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (activeLocale() === "fa-IR" ? (d.getDay() + 1) % 7 : d.getDay()));
  return d;
}
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function activeLocale() { try { return localStorage.getItem("smart-calendar-language") === "fa" ? "fa-IR" : "en-US"; } catch { return "en-US"; } }
function dateText(date, options = { month: "short", day: "numeric" }) {
  return new Intl.DateTimeFormat(activeLocale(), options).format(date);
}
function timeText(date) {
  return date.toLocaleTimeString(activeLocale(), { hour: "numeric", minute: "2-digit" }).replace(":00", "");
}
function dateAt(base, offset, hour, minute = 0) {
  const d = new Date(base);
  d.setDate(d.getDate() + offset);
  d.setHours(hour, minute, 0, 0);
  return d;
}
function seedEvents() {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  const samples = [
    [0, 9, 0, 10, 0, "Weekly planning", COLORS[0], "Focus time"],
    [1, 10, 30, 12, 0, "Deep work session", COLORS[1], "Heads down"],
    [2, 13, 0, 14, 0, "Project check-in", COLORS[2], "Team room"],
    [3, 9, 30, 10, 30, "Read & research", COLORS[3], "Focus time"],
    [4, 15, 0, 16, 0, "Weekly review", COLORS[4], "Wrap up"]
  ];
  return samples.map((s, i) => ({ id: "sample-" + i, start: dateAt(monday, s[0], s[1], s[2]), end: dateAt(monday, s[0], s[3], s[4]), title: s[5], color: s[6], place: s[7] }));
}
function loadEvents() {
  try {
    const saved = localStorage.getItem(EVENTS_KEY);
    if (saved) return JSON.parse(saved).map(e => ({ ...e, start: new Date(e.start), end: new Date(e.end) }));
  } catch { /* Use demo events when no local calendar can be loaded. */ }
  return seedEvents();
}
function endpointFor(baseUrl) {
  const base = baseUrl.trim().replace(/\/+$/, "");
  return /\/chat\/completions$/i.test(base) ? base : base + "/chat/completions";
}
function IconButton({ title, onClick, children }) {
  return <button className="icon-button" type="button" title={title} aria-label={title} onClick={onClick}>{children}</button>;
}

export default function App() {
  const [authStatus, setAuthStatus] = useState("checking");
  const [user, setUser] = useState(null);
  const [authNotice, setAuthNotice] = useState("");
  const [language, setLanguage] = useState(() => { try { return localStorage.getItem("smart-calendar-language") || "en"; } catch { return "en"; } });
  const [languageChosen, setLanguageChosen] = useState(() => { try { return Boolean(localStorage.getItem("smart-calendar-language")); } catch { return false; } });
  const [setupComplete, setSetupComplete] = useState(() => { try { return localStorage.getItem("smart-calendar-setup-complete") === "yes"; } catch { return false; } });
  const [setupJustDone, setSetupJustDone] = useState(false);
  const [aiProviders, setAiProviders] = useState([]);
  const [showSecurityInfo, setShowSecurityInfo] = useState(false);
  const [pendingCalendarProposal, setPendingCalendarProposal] = useState(null);
  const [pendingMemoryProposal, setPendingMemoryProposal] = useState(null);
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const eventsHydratedForUserRef = useRef(null);
  const skipEventPersistRef = useRef(false);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState("week");
  const [events, setEvents] = useState(loadEvents);
  const [showSettings, setShowSettings] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => { try { return localStorage.getItem("smart-calendar-onboarding-done") !== "yes"; } catch { return true; } });
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [showEventModal, setShowEventModal] = useState(false);
  const [editingEventId, setEditingEventId] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [showGoogleModal, setShowGoogleModal] = useState(false);
  const [googleSdkReady, setGoogleSdkReady] = useState(Boolean(window.google?.accounts?.oauth2));
  const [accessToken, setAccessToken] = useState("");
  const [googleError, setGoogleError] = useState("");
  const [googleSyncState, setGoogleSyncState] = useState("idle");
  const googleTokenClientRef = useRef(null);
  const syncRequestRef = useRef(0);
  const pressTimerRef = useRef(null);
  const longPressTriggeredRef = useRef(false);
  const [config, setConfig] = useState(loadConfig);
  const [showApiKey, setShowApiKey] = useState(false);
  const [testState, setTestState] = useState("idle");
  const [testMessage, setTestMessage] = useState("");
  const [messages, setMessages] = useState([{ id: "welcome", role: "assistant", content: "Hey! I’m your calendar sidekick. ☀️\n\nI’m ready to help you think through your schedule. Connect an OpenAI-compatible model in settings to get started." }]);
  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);
  const [mobilePanel, setMobilePanel] = useState("calendar");
  const [toast, setToast] = useState("");
  const [draft, setDraft] = useState({ title: "", date: dayKey(new Date()), start: "09:00", end: "10:00", color: COLORS[0], place: "", location: "", allDay: false, reminderMinutes: 10, recurrence: "none" });
  const chatEndRef = useRef(null);

  useEffect(() => {
    try { localStorage.removeItem("smart-calendar-ai-config-v1"); } catch { /* Ignore unavailable browser storage. */ }
  }, []);

  useEffect(() => {
    if (user) return;
    try { localStorage.setItem(EVENTS_KEY, JSON.stringify(events.filter(event => event.source !== "google"))); } catch { /* Browser storage can be unavailable. */ }
  }, [events, user]);

  useEffect(() => {
    if (!user || eventsHydratedForUserRef.current !== user.id) return undefined;
    if (skipEventPersistRef.current) {
      skipEventPersistRef.current = false;
      return undefined;
    }
    const timer = setTimeout(() => {
      const localEvents = events.filter(event => event.source !== "google").map(event => ({
        id: event.id,
        title: event.title,
        start: event.start.toISOString(),
        end: event.end.toISOString(),
        color: event.color || COLORS[0],
        place: event.place || "",
        location: event.location || "",
        allDay: Boolean(event.allDay),
        reminderMinutes: event.reminderMinutes ?? 10,
        recurrence: event.recurrence || "none"
      }));
      apiFetch("/api/events", { method: "PUT", body: JSON.stringify({ events: localEvents }) })
        .catch(error => setToast("Could not save your calendar: " + error.message));
    }, 400);
    return () => clearTimeout(timer);
  }, [events, user]);
  async function establishSession(account) {
    const [eventData, settingsData] = await Promise.all([
      apiFetch("/api/events"),
      apiFetch("/api/ai/settings")
    ]);
    const accountEvents = (eventData.events || []).map(event => ({
      ...event,
      start: new Date(event.start),
      end: new Date(event.end),
      source: "local"
    }));
    skipEventPersistRef.current = true;
    eventsHydratedForUserRef.current = account.id;
    setEvents(accountEvents);
    setConfig({ baseUrl: settingsData.baseUrl || blankConfig.baseUrl, apiKey: "", model: settingsData.model || "", proxyUrl: settingsData.providers?.[0]?.proxyUrl || "", providers: settingsData.providers || [] });
    setApiKeyConfigured(Boolean(settingsData.apiKeyConfigured));
    setAiProviders(Array.isArray(settingsData.providers) ? settingsData.providers : []);
    setUser(account);
    setAuthNotice("");
    setAuthStatus("authenticated");
  }

  useEffect(() => {
    let active = true;
    async function boot() {
      if (!API_AVAILABLE) {
        setAuthStatus("backend-missing");
        return;
      }
      if (LOCAL_MODE) {
        try {
          const result = await apiFetch("/api/auth/me");
          if (!active) return;
          await establishSession(result.user);
        } catch (error) {
          if (!active) return;
          setAuthStatus("backend-error");
          setAuthNotice(error.message || "The local Smart Calendar server is not responding.");
        }
        return;
      }
      const params = new URLSearchParams(window.location.search);
      const verificationToken = params.get("verify");
      if (verificationToken) {
        try {
          const result = await apiFetch("/api/auth/verify-email", {
            method: "POST",
            body: JSON.stringify({ token: verificationToken })
          });
          if (active) setAuthNotice(result.message || "Email verified. You can now sign in.");
        } catch (error) {
          if (active) setAuthNotice(error.message || "This verification link is invalid or expired.");
        } finally {
          params.delete("verify");
          const query = params.toString();
          window.history.replaceState({}, "", window.location.pathname + (query ? "?" + query : "") + window.location.hash);
        }
      }
      try {
        const result = await apiFetch("/api/auth/me");
        if (!active) return;
        await establishSession(result.user);
      } catch (error) {
        if (!active) return;
        setAuthStatus(error.status === 401 ? "guest" : "backend-error");
        if (error.status !== 401) setAuthNotice(error.message || "The account server is not responding.");
      }
    }
    boot();
    return () => { active = false; };
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, sending]);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  const visibleDays = useMemo(() => {
    if (view === "day") return [new Date(currentDate)];
    if (view === "month") {
      const first = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      const begin = startOfWeek(first);
      return Array.from({ length: 42 }, (_, i) => {
        const d = new Date(begin);
        d.setDate(begin.getDate() + i);
        return d;
      });
    }
    const begin = startOfWeek(currentDate);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(begin);
      d.setDate(begin.getDate() + i);
      return d;
    });
  }, [currentDate, view]);

  async function googleApiRequest(path, method = "GET", body = null, token = accessToken) {
    const response = await fetch("https://www.googleapis.com/calendar/v3" + path, {
      method,
      headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.error?.message || ("Google Calendar request failed (" + response.status + ")."));
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function syncGoogleCalendar(token = accessToken, days = visibleDays) {
    if (!token || !days?.length) return;
    const requestId = ++syncRequestRef.current;
    setGoogleSyncState("syncing");
    try {
      const from = new Date(days[0]);
      from.setHours(0, 0, 0, 0);
      const until = new Date(days[days.length - 1]);
      until.setDate(until.getDate() + 1);
      until.setHours(0, 0, 0, 0);
      const query = new URLSearchParams({
        timeMin: from.toISOString(),
        timeMax: until.toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "2500"
      });
      const data = await googleApiRequest("/calendars/primary/events?" + query.toString(), "GET", null, token);
      if (requestId !== syncRequestRef.current) return;
      const syncedEvents = (data.items || []).filter(item => item.status !== "cancelled").map(googleEventToAppEvent);
      setEvents(previous => [...previous.filter(event => event.source !== "google"), ...syncedEvents]);
      setGoogleSyncState("success");
      setGoogleError("");
    } catch (error) {
      if (requestId !== syncRequestRef.current) return;
      setGoogleSyncState("error");
      setGoogleError(error.message || "Could not sync Google Calendar.");
      if (error.status === 401) setAccessToken("");
    }
  }

  useEffect(() => {
    if (accessToken) syncGoogleCalendar(accessToken, visibleDays);
  }, [accessToken, currentDate, view]);

  useEffect(() => {
    let active = true;
    loadGoogleIdentityScript()
      .then(() => { if (active) setGoogleSdkReady(true); })
      .catch(error => { if (active) setGoogleError(error.message); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const closeOutside = event => {
      if (event.target.closest?.(".event-context-menu") || event.target.closest?.("[data-calendar-event]")) return;
      setContextMenu(null);
    };
    const closeOnEscape = event => { if (event.key === "Escape") setContextMenu(null); };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  const rangeLabel = useMemo(() => {
    if (view === "day") return dateText(currentDate, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    if (view === "month") return dateText(currentDate, { month: "long", year: "numeric" });
    const first = visibleDays[0];
    const last = visibleDays[6];
    if (first.getMonth() === last.getMonth()) return dateText(first, { month: "long", year: "numeric" });
    return dateText(first, { month: "short", day: "numeric" }) + " – " + dateText(last, { month: "short", day: "numeric", year: "numeric" });
  }, [currentDate, view, visibleDays]);

  const isConfigured = Boolean(config.baseUrl.trim() && (config.apiKey.trim() || apiKeyConfigured) && config.model.trim());
  const googleVerified = Boolean(accessToken && googleSyncState === "success");

  function navigate(direction) {
    setCurrentDate(prev => {
      const next = new Date(prev);
      if (view === "day") next.setDate(next.getDate() + direction);
      else if (view === "month") next.setMonth(next.getMonth() + direction);
      else next.setDate(next.getDate() + direction * 7);
      return next;
    });
  }
  function openNewEvent(date = currentDate, hour = 9) {
    setEditingEventId(null);
    setDraft({ title: "", date: dayKey(date), start: String(hour).padStart(2, "0") + ":00", end: String(Math.min(hour + 1, 23)).padStart(2, "0") + ":00", color: COLORS[0], place: "", location: "", allDay: false, reminderMinutes: 10, recurrence: "none" });
    setShowEventModal(true);
  }
  function openEditEvent(event) {
    if (event.source === "google" && !accessToken) {
      setGoogleError("Reconnect Google Calendar to edit this event.");
      setShowGoogleModal(true);
      return;
    }
    setEditingEventId(event.id);
    setDraft({
      title: event.title,
      date: dayKey(event.start),
      start: String(event.start.getHours()).padStart(2, "0") + ":" + String(event.start.getMinutes()).padStart(2, "0"),
      end: String(event.end.getHours()).padStart(2, "0") + ":" + String(event.end.getMinutes()).padStart(2, "0"),
      color: event.color || COLORS[0],
      place: event.place || "",
      location: event.location || "",
      allDay: Boolean(event.allDay),
      reminderMinutes: event.reminderMinutes ?? 10,
      recurrence: event.recurrence || "none"
    });
    setShowEventModal(true);
    setContextMenu(null);
  }
  function showEventContextMenu(event, x, y) {
    const menuWidth = 205;
    const menuHeight = event.source === "google" && event.googleUrl ? 150 : 116;
    setContextMenu({
      event,
      x: Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8))
    });
  }
  function clearPressTimer() {
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    pressTimerRef.current = null;
  }
  function eventInteractionProps(event) {
    return {
      "data-calendar-event": "true",
      onClick: click => {
        click.stopPropagation();
        if (longPressTriggeredRef.current) { longPressTriggeredRef.current = false; return; }
        openEditEvent(event);
      },
      onContextMenu: click => {
        click.preventDefault();
        click.stopPropagation();
        showEventContextMenu(event, click.clientX, click.clientY);
      },
      onPointerDown: pointer => {
        if (pointer.pointerType !== "touch") return;
        clearPressTimer();
        const x = pointer.clientX;
        const y = pointer.clientY;
        longPressTriggeredRef.current = false;
        pressTimerRef.current = setTimeout(() => {
          longPressTriggeredRef.current = true;
          showEventContextMenu(event, x, y);
        }, 520);
      },
      onPointerUp: clearPressTimer,
      onPointerCancel: clearPressTimer,
      onPointerLeave: clearPressTimer
    };
  }
  function startGoogleConnect(e) {
    e?.preventDefault();
    if (!GOOGLE_CLIENT_ID) {
      setGoogleError("Google Calendar connection has not been enabled for this site yet. The site owner needs to finish the one-time setup.");
      setGoogleSyncState("error");
      setShowGoogleModal(true);
      return;
    }
    if (!window.google?.accounts?.oauth2) {
      setGoogleError("Google sign-in is still loading. Please try again in a moment.");
      setShowGoogleModal(true);
      return;
    }
    setGoogleError("");
    setGoogleSyncState("idle");
    try {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GOOGLE_SCOPE,
        callback: response => {
          if (response.error || !response.access_token) {
            setGoogleError(response.error_description || response.error || "Google authorization was cancelled.");
            setGoogleSyncState("error");
            setShowGoogleModal(true);
            return;
          }
          setAccessToken(response.access_token);
          setGoogleError("");
          setGoogleSyncState("syncing");
          setShowGoogleModal(false);
          setToast("Google Calendar connected");
        },
        error_callback: response => {
          setGoogleError(response?.message || "The Google sign-in popup could not open. Allow popups and try again.");
          setGoogleSyncState("error");
          setShowGoogleModal(true);
        }
      });
      googleTokenClientRef.current = client;
      client.requestAccessToken({ prompt: "select_account" });
    } catch (error) {
      setGoogleError(error.message || "Could not start Google Calendar authorization.");
      setGoogleSyncState("error");
      setShowGoogleModal(true);
    }
  }
  function disconnectGoogle() {
    if (accessToken && window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(accessToken, () => {});
    }
    setAccessToken("");
    setEvents(previous => previous.filter(event => event.source !== "google"));
    setGoogleSyncState("idle");
    setGoogleError("");
    setToast("Google Calendar disconnected");
  }
  async function deleteEvent(event) {
    setContextMenu(null);
    if (!window.confirm("Delete “" + event.title + "”?")) return;
    try {
      if (event.source === "google") {
        if (!accessToken) {
          
          setGoogleError("Reconnect Google Calendar to delete this event.");
          setShowGoogleModal(true);
          return;
        }
        await googleApiRequest("/calendars/primary/events/" + encodeURIComponent(event.googleId || event.id), "DELETE", null, accessToken);
      }
      setEvents(previous => previous.filter(item => item.id !== event.id));
      setShowEventModal(false);
      setToast(event.source === "google" ? "Event deleted from Google Calendar" : "Event deleted");
    } catch (error) {
      if (error.status === 401) { setAccessToken("");  setShowGoogleModal(true); }
      setToast(error.message || "Could not delete the event.");
    }
  }
  async function saveEvent(e) {
    e.preventDefault();
    if (!draft.title.trim()) return;
    const parts = draft.date.split("-").map(Number);
    const s = draft.start.split(":").map(Number);
    const t = draft.end.split(":").map(Number);
    const start = new Date(parts[0], parts[1] - 1, parts[2], draft.allDay ? 0 : s[0], draft.allDay ? 0 : s[1]);
    const end = draft.allDay ? new Date(start) : new Date(parts[0], parts[1] - 1, parts[2], t[0], t[1]);
    if (draft.allDay) end.setDate(end.getDate() + 1);
    if (end <= start) { setToast(language === "fa" ? "زمان پایان باید بعد از شروع باشد." : "End time must be after start time."); return; }
    const existing = events.find(event => event.id === editingEventId);
    try {
      if (existing?.source === "google") {
        if (!accessToken) {
          
          setGoogleError("Reconnect Google Calendar to save changes to this event.");
          setShowGoogleModal(true);
          return;
        }
        const updated = await googleApiRequest(
          "/calendars/primary/events/" + encodeURIComponent(existing.googleId || existing.id),
          "PATCH",
          googlePayloadFromDraft(draft, start, end),
          accessToken
        );
        setEvents(previous => previous.map(event => event.id === existing.id ? { ...googleEventToAppEvent(updated), color: draft.color } : event));
        setToast("Google Calendar event updated");
      } else if (accessToken) {
        const created = await googleApiRequest(
          "/calendars/primary/events",
          "POST",
          googlePayloadFromDraft(draft, start, end),
          accessToken
        );
        setEvents(previous => [...previous.filter(event => event.id !== existing?.id), { ...googleEventToAppEvent(created), color: draft.color }]);
        setToast(language === "fa" ? "رویداد به تقویم گوگل اضافه شد." : "Event added to Google Calendar");
      } else if (existing) {
        setEvents(previous => previous.map(event => event.id === existing.id ? { ...event, ...draft, title: draft.title.trim(), start, end } : event));
        setToast("Event updated");
      } else {
        setEvents(previous => [...previous, { ...draft, id: crypto.randomUUID(), source: "local", title: draft.title.trim(), start, end }]);
        setToast("Event added to your calendar");
      }
      setCurrentDate(start);
      setView("week");
      setShowEventModal(false);
      setEditingEventId(null);
    } catch (error) {
      if (error.status === 401) { setAccessToken("");  setShowGoogleModal(true); }
      setToast(error.message || "Could not save the event.");
    }
  }
  function buildProvidersPayload() {
    const current = aiProviders.length ? aiProviders : [{ id: "primary", name: "Primary", baseUrl: config.baseUrl, model: config.model, proxyUrl: config.proxyUrl || "", apiKeyConfigured }];
    return current.map((p, i) => ({
      id: p.id || (i ? "provider-" + i : "primary"),
      name: p.name || (i ? "Backup " + (i + 1) : "Primary"),
      baseUrl: i === 0 ? config.baseUrl : (p.baseUrl || ""),
      model: i === 0 ? config.model : (p.model || ""),
      apiKey: i === 0 ? (config.apiKey || "") : (p.apiKey || ""),
      proxyUrl: i === 0 ? (config.proxyUrl || p.proxyUrl || "") : (p.proxyUrl || ""),
      apiKeyConfigured: i === 0 ? apiKeyConfigured : Boolean(p.apiKeyConfigured),
      enabled: p.enabled !== false
    }));
  }
  async function saveConfig(e) {
    e.preventDefault();
    try {
      const providers = buildProvidersPayload();
      const result = await apiFetch("/api/ai/settings", { method: "PUT", body: JSON.stringify({ providers, fallbackEnabled: true }) });
      setConfig(previous => ({ ...previous, apiKey: "", proxyUrl: result.providers?.[0]?.proxyUrl || previous.proxyUrl, baseUrl: result.baseUrl || previous.baseUrl, model: result.model || previous.model }));
      setAiProviders(result.providers || providers.map(p => ({ ...p, apiKey: "", apiKeyConfigured: true })));
      setApiKeyConfigured(Boolean(result.apiKeyConfigured));
      setTestMessage(LOCAL_MODE ? "AI settings saved on this computer." : "AI settings saved to your account.");
      setTestState("success");
      setShowSettings(false);
      setToast(LOCAL_MODE ? "AI settings saved on this computer" : "AI settings saved to your account");
    } catch (error) {
      setTestState("error");
      setTestMessage(error.message || "Could not save your AI settings.");
    }
  }
  async function testConnection(e) {
    e.preventDefault();
    setTestState("testing"); setTestMessage("");
    const providers = buildProvidersPayload().filter(p => p.enabled !== false);
    if (!providers.length || providers.some(p => !p.baseUrl.trim() || !p.model.trim() || (!String(p.apiKey || "").trim() && !p.apiKeyConfigured))) {
      setTestState("error");
      setTestMessage("Each enabled provider needs a Base URL, model, and API key.");
      return;
    }
    try {
      const result = await apiFetch("/api/ai/test", { method: "POST", body: JSON.stringify({ providers, fallbackEnabled: true }) });
      setTestState("success");
      setTestMessage(result.message || "Connection successful. Your model replied to the test request.");
    } catch (error) {
      setTestState("error");
      setTestMessage(error.message || "Could not connect. Check your provider URLs, models, proxy, and API keys.");
    }
  }
  async function handleSignOut() {
    try { await apiFetch("/api/auth/logout", { method: "POST" }); } catch { /* Clear local account state even if the server session expired. */ }
    eventsHydratedForUserRef.current = null;
    skipEventPersistRef.current = true;
    setUser(null);
    setAuthStatus("guest");
    setEvents([]);
    setConfig(blankConfig);
    setApiKeyConfigured(false);
    setMessages([{ id: "welcome", role: "assistant", content: "Hey! I’m your calendar sidekick. ☀️\n\nConnect your AI model in settings when you're ready." }]);
    setToast("");
  }
  async function sendMessage(e) {
    e?.preventDefault();
    const content = chatInput.trim();
    if (!content || sending) return;
    if (!isConfigured) {
      setShowSettings(true);
      setTestState("error");
      setTestMessage("Add your Base URL, API key, and model to start chatting.");
      return;
    }
    setSetupJustDone(false);
    const outgoing = { id: crypto.randomUUID(), role: "user", content };
    const history = [...messages, outgoing];
    setMessages(history);
    setChatInput("");
    setSending(true);
    try {
      const memoryResult = await apiFetch("/api/memory").catch(() => ({ files: {} }));
      const memoryText = Object.entries(memoryResult.files || {}).map(([name, content]) => name + "\\n" + content).join("\\n\\n");
      const systemContent = (language === "fa"
        ? "تو دستیار برنامه‌ریزی شخصی Smart Calendar هستی و فقط فارسی حرف بزن. از حافظهٔ کاربر و رویدادهای تقویم که در ادامه آمده برای پیشنهاد برنامهٔ واقع‌بینانه استفاده کن. هیچ تغییری را مستقیماً اعمال نکن. اگر کاربر برنامه‌ریزی یا تغییر تقویم خواست، پیشنهادهای دقیق را به شکل یک آرایه JSON در تگ <calendar_proposal> بنویس؛ هر مورد باید title,start,end,color,place,action داشته باشد و start/end تاریخ ISO باشند؛ action یکی از create/update/delete است و برای update/delete باید id رویداد موجود را بفرستی. بعد از تگ توضیح بده که تغییرات فقط با تأیید کاربر اعمال می‌شوند. اگر نکتهٔ پایدار و مفیدی دربارهٔ هدف، ترجیح یا عادت کاربر فهمیدی که هنوز در حافظه نیست یا باید اصلاح شود، یک پیشنهاد داخل تگ <memory_proposal> با JSON شامل file (یکی از profile.md, goals.md, preferences.md, routines.md, planning.md)، content (محتوای کامل فایل Markdown) و reason قرار بده و از کاربر اجازه بگیر. هیچ‌وقت ادعا نکن تغییری اعمال یا حافظه‌ای ذخیره شده مگر پس از تأیید کاربر.\n\nحافظهٔ فعلی کاربر:\n"
        : "You are the personal planning partner in Smart Calendar. Speak only English. Use the user's memory and calendar events to make realistic, sustainable plans. Never apply changes directly. When the user asks to plan or change the calendar, propose precise changes inside a <calendar_proposal> tag containing a JSON array; each item must include title,start,end,color,place,action, with ISO start/end timestamps, and action one of create/update/delete. For update/delete, include the existing event id. Explain that changes are applied only after the user approves. If you learn a durable and useful goal, preference, or routine that is missing from memory or needs updating, include one <memory_proposal> tag with JSON containing file (one of profile.md, goals.md, preferences.md, routines.md, planning.md), content (the full Markdown file text), and reason, then ask permission. Never claim a calendar change or memory update has been applied before the user approves.\n\nCurrent user memory:\n")
        + (memoryText || (language === "fa" ? "هنوز حافظه‌ای ثبت نشده است." : "No memory files have been saved yet."))
        + "\\n\\n" + (language === "fa" ? "رویدادهای فعلی تقویم (شناسه برای update/delete):\\n" : "Current calendar events (IDs for update/delete):\\n")
        + events.slice(0, 120).map(event => ({ id: event.id, title: event.title, start: event.start.toISOString(), end: event.end.toISOString(), place: event.place || "", source: event.source || "local" })).map(event => JSON.stringify(event)).join("\\n");
      const data = await apiFetch("/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({ messages: [
          { role: "system", content: systemContent },
          ...history.filter(m => m.role === "user" || m.role === "assistant").map(m => ({ role: m.role, content: m.content }))
        ] })
      });
      const rawAnswer = data?.content;
      if (!rawAnswer) throw new Error("The API response did not include an assistant message.");
      let answer = typeof rawAnswer === "string" ? rawAnswer : JSON.stringify(rawAnswer);
      const calendarMatch = answer.match(/<calendar_proposal>([\s\S]*?)<\/calendar_proposal>/i);
      if (calendarMatch) {
        try {
          const proposal = JSON.parse(calendarMatch[1].trim());
          setPendingCalendarProposal(Array.isArray(proposal) ? proposal : [proposal]);
          answer = answer.replace(calendarMatch[0], "").trim();
        } catch { /* Show malformed proposal text so the user can ask the assistant to restate it. */ }
      }
      const memoryMatch = answer.match(/<memory_proposal>([\s\S]*?)<\/memory_proposal>/i);
      if (memoryMatch) {
        try {
          const proposal = JSON.parse(memoryMatch[1].trim());
          if (["profile.md","goals.md","preferences.md","routines.md","planning.md"].includes(proposal.file) && typeof proposal.content === "string") {
            setPendingMemoryProposal({ ...proposal });
            answer = answer.replace(memoryMatch[0], "").trim();
          }
        } catch { /* Keep malformed proposal visible rather than silently dropping content. */ }
      }
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: "assistant", content: answer || (language === "fa" ? "پیشنهاد آماده است؛ پیش از اعمال، آن را بررسی کن." : "The proposal is ready for your review before anything is applied.") }]);
      if (data.providerName) setToast((language === "fa" ? "پاسخ از " : "Answered by ") + data.providerName);
    } catch (error) {
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: "assistant", isError: true, content: (language === "fa" ? "به هوش مصنوعی وصل نشدم. " : "I couldn’t reach your model. ") + (error.message || "Check your connection settings and try again.") }]);
    } finally { setSending(false); }
  }

  async function approveMemoryProposal(shouldSave) {
    const proposal = pendingMemoryProposal;
    setPendingMemoryProposal(null);
    if (!shouldSave || !proposal) {
      setToast(language === "fa" ? "پیشنهاد حافظه رد شد." : "Memory suggestion dismissed.");
      return;
    }
    try {
      const current = await apiFetch("/api/memory").catch(() => ({ files: {} }));
      await apiFetch("/api/memory", { method: "PUT", body: JSON.stringify({ files: { ...(current.files || {}), [proposal.file]: proposal.content } }) });
      setToast(language === "fa" ? "حافظهٔ شخصی به‌روزرسانی شد." : "Personal memory updated.");
    } catch (error) {
      setToast((language === "fa" ? "ذخیرهٔ حافظه ناموفق بود: " : "Could not save memory: ") + error.message);
    }
  }

  async function applyCalendarProposal() {
    if (!pendingCalendarProposal?.length || !accessToken) {
      setToast(language === "fa" ? "ابتدا تقویم گوگل را متصل کن." : "Reconnect Google Calendar before applying changes.");
      return;
    }
    setSending(true);
    try {
      const nextEvents = [...events];
      for (const proposal of pendingCalendarProposal) {
        const action = String(proposal.action || "create").toLowerCase();
        const title = String(proposal.title || "").trim();
        const start = new Date(proposal.start);
        const end = new Date(proposal.end);
        if (action !== "delete" && (!title || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start)) {
          throw new Error("The proposed event has invalid dates or a missing title. Ask the assistant to revise it.");
        }
        const existing = proposal.id ? nextEvents.find(event => event.id === proposal.id || event.googleId === proposal.id) : null;
        if (action === "delete") {
          if (!existing) throw new Error("An event to delete could not be found. Ask the assistant to refresh the proposal.");
          if (existing.source === "google") await googleApiRequest("/calendars/primary/events/" + encodeURIComponent(existing.googleId || existing.id), "DELETE", null, accessToken);
          nextEvents.splice(nextEvents.indexOf(existing), 1);
          continue;
        }
        const draftEvent = { title, place: String(proposal.place || ""), color: /^#[0-9a-f]{6}$/i.test(String(proposal.color || "")) ? proposal.color : COLORS[0] };
        const payload = googlePayloadFromDraft(draftEvent, start, end);
        if (action === "update" && existing?.source === "google") {
          const result = await googleApiRequest("/calendars/primary/events/" + encodeURIComponent(existing.googleId || existing.id), "PATCH", payload, accessToken);
          const normalized = { ...googleEventToAppEvent(result), color: draftEvent.color };
          const index = nextEvents.findIndex(event => event.id === existing.id);
          if (index >= 0) nextEvents[index] = normalized;
        } else {
          const result = await googleApiRequest("/calendars/primary/events", "POST", payload, accessToken);
          const normalized = { ...googleEventToAppEvent(result), color: draftEvent.color };
          if (existing) {
            const index = nextEvents.findIndex(event => event.id === existing.id);
            if (index >= 0) nextEvents.splice(index, 1);
          }
          nextEvents.push(normalized);
        }
      }
      setEvents(nextEvents);
      setPendingCalendarProposal(null);
      syncGoogleCalendar(accessToken);
      setToast(language === "fa" ? "تغییرات تأییدشده در تقویم گوگل اعمال شد." : "Approved changes were applied to Google Calendar.");
    } catch (error) {
      setToast((language === "fa" ? "اعمال تغییرات ناموفق بود: " : "Could not apply calendar changes: ") + error.message);
    } finally { setSending(false); }
  }

  function handleSetupComplete(result) {
    if (result?.action === "ai-saved") {
      const settings = result.settings || {};
      setApiKeyConfigured(Boolean(settings.apiKeyConfigured));
      setAiProviders(Array.isArray(settings.providers) ? settings.providers : []);
      const primary = (settings.providers || [])[0] || {};
      setConfig({ baseUrl: settings.baseUrl || primary.baseUrl || blankConfig.baseUrl, model: settings.model || primary.model || "", apiKey: "", proxyUrl: primary.proxyUrl || "", providers: settings.providers || [] });
      return;
    }
    if (result?.action === "complete") {
      setLanguage(result.language || "en");
      setLanguageChosen(true);
      setSetupComplete(true);
      setSetupJustDone(true);
      setConfig(result.config || blankConfig);
      setApiKeyConfigured(true);
      setAiProviders(result.config?.providers || aiProviders);
      setMessages(result.messages?.length ? result.messages : [{ id: crypto.randomUUID(), role: "assistant", content: result.language === "fa" ? "سلام! حالا که با هم آشنا شدیم، دوست داری اول چه چیزی را برنامه‌ریزی کنیم؟" : "Hi! Now that we have met, what would you like us to plan first?" }]);
      setMobilePanel("assistant");
      setShowOnboarding(false);
    }
  }

  if (!languageChosen && !setupComplete) {
    return <LanguageGate onChoose={value => {
      try { localStorage.setItem("smart-calendar-language", value); } catch {}
      setLanguage(value);
      setLanguageChosen(true);
    }} />;
  }
  if (authStatus !== "authenticated" || !user) {
    return <AuthGate status={authStatus} message={authNotice} onMessage={setAuthNotice} onAuthenticated={establishSession} />;
  }
  if (!setupComplete || !googleVerified) {
    return <SetupWizard accessToken={accessToken} googleVerified={googleVerified} googleError={googleError} googleSdkReady={googleSdkReady} startGoogleConnect={startGoogleConnect} initialSetupComplete={setupComplete} onComplete={handleSetupComplete} onResume={() => { setShowOnboarding(false); setLanguage(activeLocale() === "fa-IR" ? "fa" : "en"); }} />;
  }

  return (
    <main className="app-shell" lang={language} dir={language === "fa" ? "rtl" : "ltr"}>
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><CalendarDays size={21} /></div><span>smart<span className="brand-light">calendar</span></span><span className="beta-tag">BETA</span></div>
        <div className="topbar-actions"><div className="today-date"><span className="date-dot" /> {language === "fa" ? "زمانت را آگاهانه برنامه‌ریزی کن" : "Your time, thoughtfully planned"}</div><span className="account-email" title={LOCAL_MODE ? "Data stays on this computer" : user.email}>{LOCAL_MODE ? "Local workspace" : user.email}</span><button type="button" className="security-lock-button" title={language === "fa" ? "امنیت و حریم خصوصی" : "Security and privacy"} aria-label={language === "fa" ? "امنیت و حریم خصوصی" : "Security and privacy"} onClick={() => setShowSecurityInfo(true)}><LockKeyhole size={18} /></button><IconButton title={language === "fa" ? "راهنمای راه‌اندازی" : "Setup guide"} onClick={() => { setOnboardingStep(0); setShowOnboarding(true); }}><CircleHelp size={19} /></IconButton>{!LOCAL_MODE && <button type="button" className="account-signout" onClick={handleSignOut}>Sign out</button>}<div className="avatar">{LOCAL_MODE ? "L" : user.email.slice(0, 1).toUpperCase()}</div></div>
      </header>

      <div className="mobile-switch">
        <button className={mobilePanel === "calendar" ? "active" : ""} onClick={() => setMobilePanel("calendar")}><CalendarDays size={16} /> Calendar</button>
        <button className={mobilePanel === "assistant" ? "active" : ""} onClick={() => setMobilePanel("assistant")}><Sparkles size={16} /> AI assistant</button>
      </div>

      <section className={"workspace" + (setupJustDone ? " workspace-expanded" : "")}>
        <section className={"calendar-panel " + (mobilePanel === "assistant" ? "mobile-hidden" : "")}>
          <div className="calendar-toolbar">
            <button className="create-button" onClick={() => openNewEvent()}><Plus size={18} /> {language === "fa" ? "ایجاد" : "Create"}</button>
            <div className="date-navigation">
              <button className="today-button" onClick={() => setCurrentDate(new Date())}>{language === "fa" ? "امروز" : "Today"}</button>
              <IconButton title="Previous" onClick={() => navigate(-1)}><ChevronLeft size={19} /></IconButton>
              <IconButton title="Next" onClick={() => navigate(1)}><ChevronRight size={19} /></IconButton>
              <h1>{rangeLabel}</h1>
            </div>
            <div className="view-picker">{["day", "week", "month"].map(option => <button key={option} className={view === option ? "selected" : ""} onClick={() => setView(option)}>{language === "fa" ? ({ day: "روز", week: "هفته", month: "ماه" }[option]) : option[0].toUpperCase() + option.slice(1)}</button>)}<IconButton title="Calendar options"><MoreHorizontal size={20} /></IconButton></div>
          </div>
          <div className="calendar-subbar">
            <div className="calendar-caption"><span className="tiny-calendar"><CalendarDays size={14} /></span> {language === "fa" ? "تقویم من" : "My calendar"} <ChevronDown size={14} /></div>
            <div className="calendar-subbar-right">
              <div className="calendar-caption muted-caption"><span className="legend-dot" /> {language === "fa" ? "شخصی" : "Personal"} <span className="legend-dot teal" /> {language === "fa" ? "زمان تمرکز" : "Focus time"}</div>
              {accessToken ? <div className="google-connected-controls"><span className="google-status-label"><span className="google-status-dot" /> Google Calendar</span><button type="button" onClick={() => syncGoogleCalendar()} disabled={googleSyncState === "syncing"} title="Sync the visible date range"><RefreshCw size={13} className={googleSyncState === "syncing" ? "spin" : ""} /> Sync</button><button type="button" onClick={disconnectGoogle}>Disconnect</button></div> : <button type="button" className="google-connect-button" onClick={() => { setGoogleError(""); startGoogleConnect(); }}><CalendarDays size={14} /> {language === "fa" ? "اتصال گوگل" : "Connect Google"}</button>}
            </div>
          </div>

          {view === "month" ? (
            <div className="month-view">
              <div className="month-weekdays">{(language === "fa" ? ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]).map(d => <div key={d}>{d}</div>)}</div>
              <div className="month-cells">{visibleDays.map(day => {
                const dayEvents = events.filter(event => sameDay(event.start, day));
                return <button key={dayKey(day)} className={"month-cell " + (day.getMonth() !== currentDate.getMonth() ? "outside-month " : "") + (sameDay(day, new Date()) ? "is-today" : "")} onClick={() => { setCurrentDate(day); setView("day"); }}>
                  <span className="month-number">{day.getDate()}</span>
                  {dayEvents.slice(0, 3).map(event => <span key={event.id} className="month-event" style={{ "--event-color": event.color }} {...eventInteractionProps(event)} role="button" tabIndex={0} aria-label={event.title + ", edit or open event options"}>{event.title}</span>)}
                  {dayEvents.length > 3 && <span className="more-events">+{dayEvents.length - 3} more</span>}
                </button>;
              })}</div>
            </div>
          ) : (
            <div className="calendar-scroll">
              <div className="week-header" style={{ gridTemplateColumns: "60px repeat(" + visibleDays.length + ", minmax(104px, 1fr))" }}>
                <div className="time-corner"><Clock3 size={15} /></div>
                {visibleDays.map(day => <div key={dayKey(day)} className={"day-heading " + (sameDay(day, new Date()) ? "is-today" : "")}><span>{dateText(day, { weekday: "short" }).toUpperCase()}</span><strong>{day.getDate()}</strong></div>)}
              </div>
              <div className="time-grid" style={{ gridTemplateColumns: "60px repeat(" + visibleDays.length + ", minmax(104px, 1fr))" }}>
                <div className="time-rail">{HOURS.map(hour => <div key={hour} className="time-label">{timeText(dateAt(new Date(), 0, hour))}</div>)}</div>
                {visibleDays.map(day => <div key={dayKey(day)} className={"day-track " + (sameDay(day, new Date()) ? "today-track" : "")}>
                  {HOURS.map(hour => <button key={hour} className="hour-slot" aria-label={"Add event on " + dateText(day) + " at " + timeText(dateAt(new Date(), 0, hour))} onClick={() => openNewEvent(day, hour)} />)}
                  {events.filter(event => sameDay(event.start, day)).map(event => {
                    const startMinutes = event.start.getHours() * 60 + event.start.getMinutes();
                    const endMinutes = event.end.getHours() * 60 + event.end.getMinutes();
                    const top = ((startMinutes - 7 * 60) / 60) * 64;
                    const height = Math.max(30, ((endMinutes - startMinutes) / 60) * 64 - 3);
                    if (top < 0 || top >= HOURS.length * 64) return null;
                    return <button key={event.id} className="calendar-event" style={{ top: (top + 2) + "px", height: Math.min(height, HOURS.length * 64 - top - 3) + "px", "--event-color": event.color }} {...eventInteractionProps(event)} aria-label={event.title + ", click to edit or right-click for options"}>
                      <strong>{event.title}</strong><span>{timeText(event.start)} – {timeText(event.end)}</span>
                    </button>;
                  })}
                </div>)}
              </div>
            </div>
          )}
          <div className="calendar-footer"><span><span className={"sync-dot " + (accessToken ? "google-sync-dot" : "")} /> {accessToken ? (googleSyncState === "syncing" ? (language === "fa" ? "همگام‌سازی تقویم گوگل…" : "Syncing Google Calendar…") : googleSyncState === "error" ? (language === "fa" ? "همگام‌سازی گوگل نیاز به بررسی دارد" : "Google sync needs attention") : (language === "fa" ? "تقویم گوگل متصل است" : "Google Calendar connected")) : (language === "fa" ? "تقویم در حساب تو ذخیره می‌شود" : "Your calendar is saved to your account")}</span><span>{language === "fa" ? "زمان محلی · منطقه زمانی تو" : "Local time · Your timezone"}</span></div>
        </section>

        <aside className={"assistant-panel " + (mobilePanel === "calendar" ? "mobile-hidden" : "") + (setupJustDone ? " assistant-panel-expanded" : "")}>
          <div className="assistant-header">
            <div className="assistant-title"><div className="assistant-icon"><Sparkles size={19} /></div><div><h2>{language === "fa" ? "دستیار هوشمند" : "AI assistant"}</h2><p>{language === "fa" ? "همراه برنامه‌ریزی تو" : "Your planning partner"}</p></div></div>
            <div className="assistant-actions"><span className={"connection-indicator " + (isConfigured ? "connected" : "")} title={isConfigured ? "Model settings filled in" : "Model not configured"} /><IconButton title="AI settings" onClick={() => { setTestMessage(""); setTestState("idle"); setShowSettings(true); }}><Settings2 size={18} /></IconButton><IconButton title="New conversation" onClick={() => setMessages([{ id: crypto.randomUUID(), role: "assistant", content: "Fresh page, fresh thoughts. What would you like to plan?" }])}><Plus size={18} /></IconButton></div>
          </div>
          <div className="assistant-context"><div className="context-icon"><Zap size={16} /></div><div><strong>{language === "fa" ? "آگاهانه‌تر برنامه‌ریزی کنیم" : "A little more intentional"}</strong><span>{language === "fa" ? "برای چیزهای مهم امروز جا باز کن." : "Make room for what matters today."}</span></div><ArrowRight size={16} className="context-arrow" /></div>
          <div className="chat-area">
            <div className="chat-day-label"><span /> {language === "fa" ? "امروز" : "TODAY"} <span /></div>
            {messages.map(message => <div key={message.id} className={"message-row " + (message.role === "user" ? "user-row" : "")}>
              {message.role === "assistant" && <div className="message-avatar"><Sparkles size={14} /></div>}
              <div className={"message-bubble " + (message.role === "user" ? "user-bubble" : "assistant-bubble") + (message.isError ? " error-bubble" : "")}>{message.content.split("\n").map((line, i) => line ? <p key={i}>{line}</p> : <div key={i} className="message-space" />)}</div>
            </div>)}
            {sending && <div className="message-row"><div className="message-avatar"><Sparkles size={14} /></div><div className="message-bubble assistant-bubble typing"><span /><span /><span /></div></div>}
            <div ref={chatEndRef} />
          </div>
          {pendingCalendarProposal && <section className="approval-card calendar-approval">
            <div className="approval-card-heading"><CalendarDays size={17}/><div><strong>{language === "fa" ? "پیشنهاد تغییر تقویم" : "Calendar change proposal"}</strong><span>{language === "fa" ? "هیچ چیز هنوز تغییر نکرده است." : "Nothing has changed yet."}</span></div></div>
            <div className="approval-proposal-list">{pendingCalendarProposal.map((item,i)=><div className="approval-proposal" key={item.id || i}><span className="approval-action">{String(item.action||"create").toUpperCase()}</span><strong>{item.title || (language === "fa" ? "رویداد بدون عنوان" : "Untitled event")}</strong>{item.action !== "delete" && <small>{item.start ? new Date(item.start).toLocaleString(activeLocale(),{dateStyle:"medium",timeStyle:"short"}) : "?"} – {item.end ? new Date(item.end).toLocaleTimeString(activeLocale(),{hour:"numeric",minute:"2-digit"}) : "?"}</small>}{item.place && <p>{item.place}</p>}</div>)}</div>
            <p className="approval-note"><LockKeyhole size={13}/>{language === "fa" ? "فقط با تأیید تو تغییرات به تقویم اصلی گوگل اعمال می‌شود." : "Changes reach your primary Google Calendar only after you approve."}</p>
            <div className="approval-buttons"><button type="button" className="secondary-button" onClick={() => setPendingCalendarProposal(null)}>{language === "fa" ? "رد پیشنهاد" : "Reject"}</button><button type="button" className="primary-button" onClick={applyCalendarProposal} disabled={sending}><Check size={15}/>{language === "fa" ? "تأیید و اعمال" : "Approve & apply"}</button></div>
          </section>}
          {pendingMemoryProposal && <section className="approval-card memory-approval">
            <div className="approval-card-heading"><FileText size={17}/><div><strong>{language === "fa" ? "پیشنهاد به‌روزرسانی حافظه" : "Memory update suggestion"}</strong><span>{pendingMemoryProposal.file} · {pendingMemoryProposal.reason || (language === "fa" ? "اطلاعات جدید دربارهٔ ترجیحات تو" : "A potentially useful planning detail")}</span></div></div>
            <pre>{pendingMemoryProposal.content}</pre>
            <p className="approval-note"><LockKeyhole size={13}/>{language === "fa" ? "تا وقتی تأیید نکنی فایل حافظه تغییر نمی‌کند." : "The memory file stays unchanged until you approve."}</p>
            <div className="approval-buttons"><button type="button" className="secondary-button" onClick={() => approveMemoryProposal(false)}>{language === "fa" ? "نه، ممنون" : "Dismiss"}</button><button type="button" className="primary-button" onClick={() => approveMemoryProposal(true)}><Check size={15}/>{language === "fa" ? "ذخیره در حافظه" : "Approve & save"}</button></div>
          </section>}
          <div className="suggestion-list"><button onClick={() => setChatInput(language === "fa" ? "برای امروز یک برنامهٔ متمرکز و متعادل پیشنهاد بده." : "Help me plan a focused, balanced day.")}><Sparkles size={14} /> {language === "fa" ? "برنامه‌ریزی امروز" : "Plan my day"}</button><button onClick={() => setChatInput(language === "fa" ? "چطور برای تمرکز عمیق وقت پیدا کنم؟" : "How can I make time for deep work?")}><Clock3 size={14} /> {language === "fa" ? "زمان تمرکز" : "Find focus time"}</button></div>
          <form className="chat-composer" onSubmit={sendMessage}>
            <textarea value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} placeholder={language === "fa" ? "دربارهٔ برنامه‌ات هر چیزی بپرس…" : "Ask anything about your schedule…"} rows={2} aria-label="Message the AI assistant" />
            <div className="composer-bottom"><span><ShieldCheck size={13} /> {language === "fa" ? "مدل انتخابی تو" : "Your model, your choice"}</span><button className="send-button" type="submit" disabled={!chatInput.trim() || sending} aria-label="Send message">{sending ? <RefreshCw size={16} className="spin" /> : <Send size={16} />}</button></div>
          </form>
          <p className="assistant-footnote">{LOCAL_MODE ? (language === "fa" ? "فضای کاری روی همین رایانه ذخیره می‌شود. درخواست‌های AI به ارائه‌دهندهٔ انتخابی تو می‌روند." : "Your workspace is stored on this computer. AI requests go to the provider you configured.") : (language === "fa" ? "واردشده با " + user.email + "." : "Signed in as " + user.email + ".")} {language === "fa" ? "هوش مصنوعی ممکن است اشتباه کند؛ برنامه‌های مهم را بررسی کن." : "AI can make mistakes; review important plans."}</p>
        </aside>
      </section>

      {showOnboarding && <div className="modal-backdrop onboarding-backdrop" role="presentation">
        <section className="onboarding-modal" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
          <div className="onboarding-top"><div className="onboarding-mark"><CalendarDays size={24} /></div><span>YOUR SETUP GUIDE</span><button className="onboarding-skip" onClick={() => { try { localStorage.setItem("smart-calendar-onboarding-done", "yes"); } catch {} setShowOnboarding(false); }}>Skip for now</button></div>
          <div className="onboarding-progress"><span className={onboardingStep >= 0 ? "done" : ""}></span><span className={onboardingStep >= 1 ? "done" : ""}></span><span className={onboardingStep >= 2 ? "done" : ""}></span></div>
          {onboardingStep === 0 ? <><p className="onboarding-eyebrow">WELCOME TO SMART CALENDAR</p><h2 id="onboarding-title">Your calendar, with a little help from AI.</h2><p className="onboarding-intro">Let’s set up your calendar and AI assistant in a few simple steps. You can finish setup now or return to this guide any time using the help icon.</p><div className="onboarding-choice"><div className="onboarding-choice-icon"><CalendarDays size={20}/></div><div><strong>1. Connect Google Calendar</strong><p>Sync your real events after Google Calendar authorization is configured for this app.</p><span className={accessToken ? "setup-status setup-ready" : "setup-status"}>{accessToken ? "Google Calendar connected" : GOOGLE_CLIENT_ID ? "Ready to connect" : "Setup is being finalized"}</span></div></div><div className="onboarding-choice"><div className="onboarding-choice-icon ai"><Sparkles size={20}/></div><div><strong>2. Connect your AI assistant</strong><p>Add an OpenAI-compatible provider URL, API key, and model name, then test the connection.</p><span className={isConfigured ? "setup-status setup-ready" : "setup-status"}>{isConfigured ? "AI settings already entered" : "Usually takes a minute"}</span></div></div><div className="onboarding-actions"><button className="primary-button onboarding-primary" onClick={() => setOnboardingStep(1)}>Let’s get started <ArrowRight size={16}/></button><span>About 3 minutes</span></div></> :
          onboardingStep === 1 ? <><p className="onboarding-eyebrow">STEP 1 OF 2</p><h2 id="onboarding-title">Connect Google Calendar</h2><p className="onboarding-intro">No long setup for you. Just connect your Google account and approve access so Smart Calendar can sync your schedule.</p><div className="onboarding-choice"><div className="onboarding-choice-icon"><CalendarDays size={20}/></div><div><strong>One secure connection</strong><p>Click Connect Google Calendar, select your Google account, and review the permission screen. Your events will then appear in this calendar.</p></div></div>{!GOOGLE_CLIENT_ID && <div className="onboarding-security"><ShieldCheck size={17}/><span>The site's Google connection is still being configured. You will be able to connect as soon as it is enabled.</span></div>}<div className="onboarding-actions"><button className="secondary-button" onClick={() => setOnboardingStep(0)}>Back</button><button className="secondary-button" onClick={() => { try { localStorage.setItem("smart-calendar-onboarding-done", "yes"); } catch {} setShowOnboarding(false); setGoogleError(""); startGoogleConnect(); }}><CalendarDays size={16}/> Connect Google Calendar</button><button className="primary-button onboarding-primary" onClick={() => setOnboardingStep(2)}>Next: AI assistant <ArrowRight size={16}/></button></div></> :
          <><p className="onboarding-eyebrow">STEP 2 OF 2</p><h2 id="onboarding-title">Connect your AI assistant</h2><p className="onboarding-intro">Use any provider that supports the OpenAI-compatible Chat Completions API.</p><ol className="onboarding-steps"><li><strong>Choose your API provider</strong><p>Get an API key and the exact model ID from your provider.</p></li><li><strong>Enter the connection details</strong><p>Open AI settings and fill in Base URL, API key, and Model name. For OpenAI, the base URL is <code>https://api.openai.com/v1</code>.</p></li><li><strong>Test, then save</strong><p>Choose “Test connection.” If it succeeds, select “Save settings” and send a message in the assistant panel.</p></li></ol><div className="onboarding-security"><ShieldCheck size={17}/><span>Your API key is encrypted on the account server and is only used for your requests. Review important AI-generated plans.</span></div><div className="onboarding-actions"><button className="secondary-button" onClick={() => setOnboardingStep(1)}>Back</button><button className="secondary-button" onClick={() => { setShowOnboarding(false); setShowSettings(true); }}>Open AI settings <Settings2 size={16}/></button><button className="primary-button onboarding-primary" onClick={() => { try { localStorage.setItem("smart-calendar-onboarding-done", "yes"); } catch {} setShowOnboarding(false); }}>Finish setup <Check size={16}/></button></div></>}
        </section>
      </div>}
      {showSettings && <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setShowSettings(false); }}>
        <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <div className="modal-header"><div className="modal-heading-icon"><Bot size={20} /></div><div><h2 id="settings-title">Connect your AI model</h2><p>Use any provider with an OpenAI-compatible chat completions API.</p></div><IconButton title="Close settings" onClick={() => setShowSettings(false)}><X size={19} /></IconButton></div>
          <form onSubmit={saveConfig} className="settings-form">
            <label>Base URL <span>Required</span><input value={config.baseUrl} onChange={e => setConfig(p => ({ ...p, baseUrl: e.target.value }))} placeholder="https://api.openai.com/v1" autoComplete="url" required /><small>Enter the provider base URL; /chat/completions is added automatically.</small></label>
            <label>API key <span>{apiKeyConfigured ? "Saved securely" : "Required"}</span><div className="secret-input"><input type={showApiKey ? "text" : "password"} value={config.apiKey} onChange={e => setConfig(p => ({ ...p, apiKey: e.target.value }))} placeholder={apiKeyConfigured ? "Leave blank to keep the saved key" : "Enter your provider API key"} autoComplete="off" required={!apiKeyConfigured} /><IconButton title={showApiKey ? "Hide API key" : "Show API key"} onClick={() => setShowApiKey(v => !v)}>{showApiKey ? <EyeOff size={17} /> : <Eye size={17} />}</IconButton></div><small>{apiKeyConfigured ? "Your key is encrypted on the server. Leave blank to keep it, or enter a new key to replace it." : "Your key is sent over HTTPS and encrypted by the account server before storage."}</small></label>
            <label>Model name <span>Required</span><input value={config.model} onChange={e => setConfig(p => ({ ...p, model: e.target.value }))} placeholder="e.g. gpt-4o-mini" autoComplete="off" required /><small>Use the exact model ID supported by your provider.</small></label>
            <label>{language === "fa" ? "آدرس پروکسی اختیاری" : "Optional HTTP/HTTPS proxy"}<input value={config.proxyUrl || ""} onChange={e => setConfig(p => ({ ...p, proxyUrl: e.target.value }))} placeholder="http://127.0.0.1:7890" autoComplete="url" /><small>{language === "fa" ? "برای نسخهٔ محلی می‌توانی پروکسی محلی وارد کنی. برای سرور آنلاین، پروکسی خصوصی پذیرفته نمی‌شود." : "The local app can use a local proxy. Hosted accounts cannot point a server-side proxy at private network addresses."}</small></label>
            <div className="settings-backups">
              <div className="settings-backups-heading"><div><strong>{language === "fa" ? "کلیدهای پشتیبان" : "Backup providers"}</strong><p>{language === "fa" ? "به‌ترتیب امتحان می‌شوند و در صورت خطا یا محدودیت، بعدی فعال می‌شود." : "Tried in order when a provider hits a limit or fails."}</p></div><button type="button" className="secondary-button" onClick={() => setAiProviders(previous => [...(previous.length ? previous : [{ id: "primary", name: "Primary", baseUrl: config.baseUrl, model: config.model, proxyUrl: config.proxyUrl || "", apiKeyConfigured }]), { id: crypto.randomUUID(), name: "Backup " + (previous.length + 1), baseUrl: "", model: "", apiKey: "", proxyUrl: "", enabled: true, apiKeyConfigured: false }])}><Plus size={14}/>{language === "fa" ? "افزودن" : "Add backup"}</button></div>
              {aiProviders.slice(1).map((provider, index) => <div className="settings-backup-card" key={provider.id}>
                <div className="settings-backup-title"><strong>{language === "fa" ? "پشتیبان " + (index + 1) : "Backup " + (index + 1)}</strong><button type="button" onClick={() => setAiProviders(previous => previous.filter(item => item.id !== provider.id))}>{language === "fa" ? "حذف" : "Remove"}</button></div>
                <label>{language === "fa" ? "نام ارائه‌دهنده" : "Provider name"}<input value={provider.name || ""} onChange={e => setAiProviders(previous => previous.map(item => item.id === provider.id ? { ...item, name: e.target.value } : item))} required /></label>
                <label>Base URL<input value={provider.baseUrl || ""} onChange={e => setAiProviders(previous => previous.map(item => item.id === provider.id ? { ...item, baseUrl: e.target.value } : item))} placeholder="https://api.example.com/v1" type="url" required /></label>
                <label>Model ID<input value={provider.model || ""} onChange={e => setAiProviders(previous => previous.map(item => item.id === provider.id ? { ...item, model: e.target.value } : item))} required /></label>
                <label>API key<input type="password" value={provider.apiKey || ""} onChange={e => setAiProviders(previous => previous.map(item => item.id === provider.id ? { ...item, apiKey: e.target.value } : item))} placeholder={provider.apiKeyConfigured ? (language === "fa" ? "کلید ذخیره شده؛ برای حفظ، خالی بگذار" : "Saved key; leave blank to keep it") : "Enter API key"} autoComplete="new-password" required={!provider.apiKeyConfigured} /></label>
                <label>{language === "fa" ? "پروکسی اختیاری" : "Optional proxy URL"}<input type="url" value={provider.proxyUrl || ""} onChange={e => setAiProviders(previous => previous.map(item => item.id === provider.id ? { ...item, proxyUrl: e.target.value } : item))} placeholder="http://127.0.0.1:7890" /></label>
                <label className="backup-enabled"><input type="checkbox" checked={provider.enabled !== false} onChange={e => setAiProviders(previous => previous.map(item => item.id === provider.id ? { ...item, enabled: e.target.checked } : item))}/>{language === "fa" ? "فعال برای پشتیبانی" : "Use this provider as a fallback"}</label>
              </div>)}
            </div>
            {testMessage && <div className={"test-message " + (testState === "error" ? "test-error" : testState === "success" ? "test-success" : "")}>{testState === "success" ? <Check size={16} /> : testState === "error" ? <CircleHelp size={16} /> : <MessageSquare size={16} />}<span>{testMessage}</span></div>}
            <div className="security-note"><ShieldCheck size={17} /><span><strong>Private to your account</strong> — your key is stored encrypted on the server and only used by your own AI requests. It is never sent back to the browser after saving.</span></div>
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={testConnection} disabled={testState === "testing"}>{testState === "testing" ? <RefreshCw size={16} className="spin" /> : <Zap size={16} />} Test connection</button><button type="submit" className="primary-button"><Check size={16} /> Save settings</button></div>
          </form>
        </section>
      </div>}

      {showEventModal && <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setShowEventModal(false); }}>
        <section className="event-modal" role="dialog" aria-modal="true" aria-labelledby="event-title">
          <div className="event-modal-top"><span>{editingEventId ? (language === "fa" ? "ویرایش رویداد" : "EDIT EVENT") : (language === "fa" ? "رویداد جدید" : "NEW EVENT")}</span><IconButton title="Close event form" onClick={() => { setShowEventModal(false); setEditingEventId(null); }}><X size={19} /></IconButton></div>
          <form onSubmit={saveEvent} className="event-form">
            <input id="event-title" className="event-title-input" value={draft.title} onChange={e => setDraft(p => ({ ...p, title: e.target.value }))} placeholder={language === "fa" ? "عنوان رویداد را بنویس" : "Add a title"} autoFocus required />
            <label className="event-field"><CalendarDays size={18} /><input type="date" value={draft.date} onChange={e => setDraft(p => ({ ...p, date: e.target.value }))} required /></label>
            <label className="event-field event-all-day"><CalendarDays size={18} /><input type="checkbox" checked={Boolean(draft.allDay)} onChange={e => setDraft(p => ({ ...p, allDay: e.target.checked }))} /><span>{language === "fa" ? "تمام‌روز" : "All-day event"}</span></label>
            {!draft.allDay && <label className="event-field"><Clock3 size={18} /><div className="event-times"><input type="time" value={draft.start} onChange={e => setDraft(p => ({ ...p, start: e.target.value }))} required /><span>{language === "fa" ? "تا" : "to"}</span><input type="time" value={draft.end} onChange={e => setDraft(p => ({ ...p, end: e.target.value }))} required /></div></label>}
            <label className="event-field"><CalendarDays size={18} /><input value={draft.location || ""} onChange={e => setDraft(p => ({ ...p, location: e.target.value }))} placeholder={language === "fa" ? "مکان (اختیاری)" : "Location (optional)"} /></label>
            <label className="event-field"><ListTodo size={18} /><input value={draft.place} onChange={e => setDraft(p => ({ ...p, place: e.target.value }))} placeholder={language === "fa" ? "توضیحات یا یادداشت (اختیاری)" : "Description or notes (optional)"} /></label>
            <div className="event-extras-grid">
              <label>{language === "fa" ? "یادآوری" : "Reminder"}<select value={draft.reminderMinutes ?? ""} onChange={e => setDraft(p => ({ ...p, reminderMinutes: e.target.value === "" ? "" : Number(e.target.value) }))}><option value="">{language === "fa" ? "پیش‌فرض تقویم" : "Calendar default"}</option><option value="0">{language === "fa" ? "در زمان رویداد" : "At event time"}</option><option value="5">5 {language === "fa" ? "دقیقه قبل" : "minutes before"}</option><option value="10">10 {language === "fa" ? "دقیقه قبل" : "minutes before"}</option><option value="15">15 {language === "fa" ? "دقیقه قبل" : "minutes before"}</option><option value="30">30 {language === "fa" ? "دقیقه قبل" : "minutes before"}</option><option value="60">1 {language === "fa" ? "ساعت قبل" : "hour before"}</option></select></label>
              <label>{language === "fa" ? "تکرار" : "Repeat"}<select value={draft.recurrence || "none"} onChange={e => setDraft(p => ({ ...p, recurrence: e.target.value }))}><option value="none">{language === "fa" ? "بدون تکرار" : "Does not repeat"}</option><option value="daily">{language === "fa" ? "هر روز" : "Daily"}</option><option value="weekly">{language === "fa" ? "هر هفته" : "Weekly"}</option><option value="monthly">{language === "fa" ? "هر ماه" : "Monthly"}</option></select></label>
            </div>
            <div className="color-choice"><span>{language === "fa" ? "رنگ رویداد" : "Event color"}</span>{COLORS.map(color => <button type="button" key={color} aria-label={"Use color " + color} className={draft.color === color ? "color-selected" : ""} style={{ backgroundColor: color }} onClick={() => setDraft(p => ({ ...p, color }))}>{draft.color === color && <Check size={13} />}</button>)}</div>
            <div className="event-modal-actions"><button type="button" className="secondary-button" onClick={() => { setShowEventModal(false); setEditingEventId(null); }}>{language === "fa" ? "لغو" : "Cancel"}</button><button type="submit" className="primary-button"><Check size={16} /> {editingEventId ? (language === "fa" ? "ذخیرهٔ تغییرات" : "Save changes") : accessToken ? (language === "fa" ? "ذخیره در تقویم گوگل" : "Save to Google Calendar") : (language === "fa" ? "ذخیرهٔ رویداد" : "Save event")}</button></div>
          </form>
        </section>
      </div>}
      {showGoogleModal && <div className="modal-backdrop google-modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setShowGoogleModal(false); }}>
        <section className="settings-modal google-modal" role="dialog" aria-modal="true" aria-labelledby="google-modal-title">
          <div className="modal-header"><div className="modal-heading-icon google-heading-icon"><CalendarDays size={20} /></div><div><h2 id="google-modal-title">Connect Google Calendar</h2><p>One secure sign-in to sync your schedule with Google Calendar.</p></div><IconButton title="Close Google Calendar settings" onClick={() => setShowGoogleModal(false)}><X size={19} /></IconButton></div>
          <div className="settings-form">
            {!GOOGLE_CLIENT_ID ? <div className="google-not-ready"><ShieldCheck size={19}/><div><strong>Google connection is not enabled yet</strong><p>This site needs a one-time setup by its owner. You don't need to create or enter anything in Google Cloud yourself.</p></div></div> :
              <div className="google-ready-copy"><div className="google-ready-mark"><Check size={18}/></div><div><strong>You're one step away</strong><p>Choose your Google account and approve calendar access on Google's secure consent screen.</p></div></div>}
            {googleError && <div className={"test-message " + (googleSyncState === "error" ? "test-error" : "")}><CircleHelp size={16} /><span>{googleError}</span></div>}
            {accessToken && <div className="test-message test-success"><Check size={16} /><span>Google Calendar is connected for this session. For security, the access token is kept in memory only.</span></div>}
            <div className="security-note"><ShieldCheck size={17}/><span><strong>Your permission</strong> — Smart Calendar can read, create, edit, and delete events on your primary calendar. You can disconnect it at any time.</span></div>
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowGoogleModal(false)}>Cancel</button>{GOOGLE_CLIENT_ID && <button type="button" className="primary-button" onClick={startGoogleConnect} disabled={!googleSdkReady}><CalendarDays size={16} /> {googleSdkReady ? "Continue with Google" : "Loading Google sign-in…"}</button>}</div>
          </div>
        </section>
      </div>}
      {showSecurityInfo && <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setShowSecurityInfo(false); }}>
        <section className="settings-modal security-info-modal" role="dialog" aria-modal="true" aria-labelledby="security-info-title">
          <div className="modal-header"><div className="modal-heading-icon"><LockKeyhole size={20}/></div><div><h2 id="security-info-title">{language === "fa" ? "امنیت و حریم خصوصی" : "Security and privacy"}</h2><p>{language === "fa" ? "کنترل‌ها و محدودیت‌های امنیتی Smart Calendar" : "What Smart Calendar does to protect your workspace"}</p></div><IconButton title="Close security details" onClick={() => setShowSecurityInfo(false)}><X size={19}/></IconButton></div>
          <div className="settings-form">
            <div className="security-note"><ShieldCheck size={18}/><span><strong>{language === "fa" ? "کلیدهای هوش مصنوعی" : "AI provider keys"}</strong> — {language === "fa" ? "کلیدها در حالت ذخیره رمزگذاری می‌شوند و مرورگر دوباره آن‌ها را دریافت نمی‌کند." : "Keys are encrypted at rest and are not sent back to the browser after saving."}</span></div>
            <div className="security-note"><CalendarDays size={18}/><span><strong>{language === "fa" ? "تقویم گوگل" : "Google Calendar"}</strong> — {language === "fa" ? "توکن دسترسی فقط تا پایان این نشست در حافظه نگه داشته می‌شود." : "The Google access token is kept in memory for this session only."}</span></div>
            <div className="security-note"><Check size={18}/><span><strong>{language === "fa" ? "تأیید قبل از اجرا" : "Approval before action"}</strong> — {language === "fa" ? "پیشنهادهای تقویم و تغییرات حافظه بدون تأیید تو ذخیره یا اجرا نمی‌شوند." : "Calendar proposals and memory updates are not applied without your approval."}</span></div>
            <p className="assistant-footnote">{language === "fa" ? "این علامت به معنی تضمین مطلق امنیت نیست؛ کلیدها و حساب‌های متصل خود را هم محافظت کن." : "The lock icon is a reminder of these safeguards, not a guarantee of absolute security. Protect your connected accounts and API keys."}</p>
            <div className="modal-actions"><button type="button" className="primary-button" onClick={() => setShowSecurityInfo(false)}>{language === "fa" ? "متوجه شدم" : "Got it"}</button></div>
          </div>
        </section>
      </div>}
      {contextMenu && <div className="event-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu" aria-label="Event actions">
        <div className="context-menu-heading">{contextMenu.event.title}</div>
        <button type="button" className="context-menu-item" role="menuitem" onClick={() => { const chosen = contextMenu.event; setContextMenu(null); openEditEvent(chosen); }}><Settings2 size={15} /> Edit event</button>
        <button type="button" className="context-menu-item danger" role="menuitem" onClick={() => deleteEvent(contextMenu.event)}><X size={15} /> Delete event</button>
        {contextMenu.event.googleUrl && <button type="button" className="context-menu-item" role="menuitem" onClick={() => { const url = contextMenu.event.googleUrl; setContextMenu(null); window.open(url, "_blank", "noopener,noreferrer"); }}><ArrowRight size={15} /> Open in Google Calendar</button>}
      </div>}
      {toast && <div className="toast"><Check size={16} /> {toast}</div>}
    </main>
  );
}
