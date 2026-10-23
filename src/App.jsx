import { useEffect, useMemo, useRef, useState } from "react";
import "./enhancements.css";
import AuthGate from "./AuthGate.jsx";
import { API_AVAILABLE, apiFetch } from "./api.js";
import {
  ArrowRight, Bot, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight,
  CircleHelp, Clock3, Eye, EyeOff, ListTodo, MessageSquare, MoreHorizontal,
  Plus, RefreshCw, Send, Settings2, ShieldCheck, Sparkles, X, Zap
} from "lucide-react";

const HOURS = Array.from({ length: 13 }, (_, i) => i + 7);
const EVENTS_KEY = "smart-calendar-events-v1";
const COLORS = ["#6d72d9", "#24a79b", "#e39c4c", "#de718d", "#6298dd"];
const blankConfig = { baseUrl: "https://api.openai.com/v1", apiKey: "", model: "" };
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.events";
function googleEventToAppEvent(item) {
  const start = item.start?.dateTime ? new Date(item.start.dateTime) : new Date((item.start?.date || dayKey(new Date())) + "T09:00:00");
  const end = item.end?.dateTime ? new Date(item.end.dateTime) : new Date((item.end?.date || item.start?.date || dayKey(new Date())) + "T10:00:00");
  return {
    id: item.id,
    googleId: item.id,
    source: "google",
    title: item.summary || "Untitled event",
    start,
    end,
    color: COLORS[1],
    place: item.description || item.location || "",
    googleUrl: item.htmlLink || ""
  };
}
function googlePayloadFromDraft(draft, start, end) {
  return {
    summary: draft.title.trim(),
    description: draft.place || "",
    start: { dateTime: start.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    end: { dateTime: end.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
  };
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
  d.setDate(d.getDate() - d.getDay());
  return d;
}
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function dateText(date, options = { month: "short", day: "numeric" }) {
  return new Intl.DateTimeFormat("en-US", options).format(date);
}
function timeText(date) {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(":00", "");
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
  const [draft, setDraft] = useState({ title: "", date: dayKey(new Date()), start: "09:00", end: "10:00", color: COLORS[0], place: "" });
  const chatEndRef = useRef(null);

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
        place: event.place || ""
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
    setConfig({ baseUrl: settingsData.baseUrl || blankConfig.baseUrl, apiKey: "", model: settingsData.model || "" });
    setApiKeyConfigured(Boolean(settingsData.apiKeyConfigured));
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
    setDraft({ title: "", date: dayKey(date), start: String(hour).padStart(2, "0") + ":00", end: String(Math.min(hour + 1, 23)).padStart(2, "0") + ":00", color: COLORS[0], place: "" });
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
      place: event.place || ""
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
    const start = new Date(parts[0], parts[1] - 1, parts[2], s[0], s[1]);
    const end = new Date(parts[0], parts[1] - 1, parts[2], t[0], t[1]);
    if (end <= start) { setToast("End time must be after start time."); return; }
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
        setEvents(previous => previous.map(event => event.id === existing.id ? googleEventToAppEvent(updated) : event));
        setToast("Google Calendar event updated");
      } else if (!existing && accessToken) {
        const created = await googleApiRequest(
          "/calendars/primary/events",
          "POST",
          googlePayloadFromDraft(draft, start, end),
          accessToken
        );
        setEvents(previous => [...previous, googleEventToAppEvent(created)]);
        setToast("Event added to Google Calendar");
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
  async function saveConfig(e) {
    e.preventDefault();
    try {
      const result = await apiFetch("/api/ai/settings", {
        method: "PUT",
        body: JSON.stringify(config)
      });
      setConfig(previous => ({ ...previous, apiKey: "", baseUrl: result.baseUrl || previous.baseUrl, model: result.model || previous.model }));
      setApiKeyConfigured(Boolean(result.apiKeyConfigured));
      setTestMessage("AI settings saved to your account.");
      setTestState("success");
      setShowSettings(false);
      setToast("AI settings saved to your account");
    } catch (error) {
      setTestState("error");
      setTestMessage(error.message || "Could not save your AI settings.");
    }
  }
  async function testConnection(e) {
    e.preventDefault();
    setTestState("testing");
    setTestMessage("");
    if (!config.baseUrl.trim() || !config.model.trim() || (!config.apiKey.trim() && !apiKeyConfigured)) {
      setTestState("error");
      setTestMessage("Enter the Base URL, API key, and model first.");
      return;
    }
    try {
      const result = await apiFetch("/api/ai/test", {
        method: "POST",
        body: JSON.stringify(config)
      });
      setTestState("success");
      setTestMessage(result.message || "Connection successful. Your model replied to the test request.");
    } catch (error) {
      setTestState("error");
      setTestMessage(error.message || "Could not connect. Check the URL, model, and API key.");
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
    const outgoing = { id: crypto.randomUUID(), role: "user", content };
    const history = [...messages, outgoing];
    setMessages(history);
    setChatInput("");
    setSending(true);
    try {
      const data = await apiFetch("/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: [
            { role: "system", content: "You are the friendly AI assistant in Smart Calendar. For now, discuss scheduling and planning in chat, but you do not have calendar-editing tools. Never claim to have changed calendar events." },
            ...history.filter(m => m.role === "user" || m.role === "assistant").map(m => ({ role: m.role, content: m.content }))
          ]
        })
      });
      const answer = data?.content;
      if (!answer) throw new Error("The API response did not include an assistant message.");
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: "assistant", content: typeof answer === "string" ? answer : JSON.stringify(answer) }]);
    } catch (error) {
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: "assistant", isError: true, content: "I couldn’t reach your model. " + (error.message || "Check your connection settings and try again.") }]);
    } finally { setSending(false); }
  }

  if (authStatus !== "authenticated" || !user) {
    return <AuthGate status={authStatus} message={authNotice} onMessage={setAuthNotice} onAuthenticated={establishSession} />;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><CalendarDays size={21} /></div><span>smart<span className="brand-light">calendar</span></span><span className="beta-tag">BETA</span></div>
        <div className="topbar-actions"><div className="today-date"><span className="date-dot" /> Your time, thoughtfully planned</div><span className="account-email" title={user.email}>{user.email}</span><IconButton title="Setup guide" onClick={() => { setOnboardingStep(0); setShowOnboarding(true); }}><CircleHelp size={19} /></IconButton><button type="button" className="account-signout" onClick={handleSignOut}>Sign out</button><div className="avatar">{user.email.slice(0, 1).toUpperCase()}</div></div>
      </header>

      <div className="mobile-switch">
        <button className={mobilePanel === "calendar" ? "active" : ""} onClick={() => setMobilePanel("calendar")}><CalendarDays size={16} /> Calendar</button>
        <button className={mobilePanel === "assistant" ? "active" : ""} onClick={() => setMobilePanel("assistant")}><Sparkles size={16} /> AI assistant</button>
      </div>

      <section className="workspace">
        <section className={"calendar-panel " + (mobilePanel === "assistant" ? "mobile-hidden" : "")}>
          <div className="calendar-toolbar">
            <button className="create-button" onClick={() => openNewEvent()}><Plus size={18} /> Create</button>
            <div className="date-navigation">
              <button className="today-button" onClick={() => setCurrentDate(new Date())}>Today</button>
              <IconButton title="Previous" onClick={() => navigate(-1)}><ChevronLeft size={19} /></IconButton>
              <IconButton title="Next" onClick={() => navigate(1)}><ChevronRight size={19} /></IconButton>
              <h1>{rangeLabel}</h1>
            </div>
            <div className="view-picker">{["day", "week", "month"].map(option => <button key={option} className={view === option ? "selected" : ""} onClick={() => setView(option)}>{option[0].toUpperCase() + option.slice(1)}</button>)}<IconButton title="Calendar options"><MoreHorizontal size={20} /></IconButton></div>
          </div>
          <div className="calendar-subbar">
            <div className="calendar-caption"><span className="tiny-calendar"><CalendarDays size={14} /></span> My calendar <ChevronDown size={14} /></div>
            <div className="calendar-subbar-right">
              <div className="calendar-caption muted-caption"><span className="legend-dot" /> Personal <span className="legend-dot teal" /> Focus time</div>
              {accessToken ? <div className="google-connected-controls"><span className="google-status-label"><span className="google-status-dot" /> Google Calendar</span><button type="button" onClick={() => syncGoogleCalendar()} disabled={googleSyncState === "syncing"} title="Sync the visible date range"><RefreshCw size={13} className={googleSyncState === "syncing" ? "spin" : ""} /> Sync</button><button type="button" onClick={disconnectGoogle}>Disconnect</button></div> : <button type="button" className="google-connect-button" onClick={() => { setGoogleError(""); startGoogleConnect(); }}><CalendarDays size={14} /> Connect Google</button>}
            </div>
          </div>

          {view === "month" ? (
            <div className="month-view">
              <div className="month-weekdays">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => <div key={d}>{d}</div>)}</div>
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
          <div className="calendar-footer"><span><span className={"sync-dot " + (accessToken ? "google-sync-dot" : "")} /> {accessToken ? (googleSyncState === "syncing" ? "Syncing Google Calendar…" : googleSyncState === "error" ? "Google sync needs attention" : "Google Calendar connected") : "Changes saved in this browser"}</span><span>Local time · Your timezone</span></div>
        </section>

        <aside className={"assistant-panel " + (mobilePanel === "calendar" ? "mobile-hidden" : "")}>
          <div className="assistant-header">
            <div className="assistant-title"><div className="assistant-icon"><Sparkles size={19} /></div><div><h2>AI assistant</h2><p>Your planning partner</p></div></div>
            <div className="assistant-actions"><span className={"connection-indicator " + (isConfigured ? "connected" : "")} title={isConfigured ? "Model settings filled in" : "Model not configured"} /><IconButton title="AI settings" onClick={() => { setTestMessage(""); setTestState("idle"); setShowSettings(true); }}><Settings2 size={18} /></IconButton><IconButton title="New conversation" onClick={() => setMessages([{ id: crypto.randomUUID(), role: "assistant", content: "Fresh page, fresh thoughts. What would you like to plan?" }])}><Plus size={18} /></IconButton></div>
          </div>
          <div className="assistant-context"><div className="context-icon"><Zap size={16} /></div><div><strong>A little more intentional</strong><span>Make room for what matters today.</span></div><ArrowRight size={16} className="context-arrow" /></div>
          <div className="chat-area">
            <div className="chat-day-label"><span /> TODAY <span /></div>
            {messages.map(message => <div key={message.id} className={"message-row " + (message.role === "user" ? "user-row" : "")}>
              {message.role === "assistant" && <div className="message-avatar"><Sparkles size={14} /></div>}
              <div className={"message-bubble " + (message.role === "user" ? "user-bubble" : "assistant-bubble") + (message.isError ? " error-bubble" : "")}>{message.content.split("\n").map((line, i) => line ? <p key={i}>{line}</p> : <div key={i} className="message-space" />)}</div>
            </div>)}
            {sending && <div className="message-row"><div className="message-avatar"><Sparkles size={14} /></div><div className="message-bubble assistant-bubble typing"><span /><span /><span /></div></div>}
            <div ref={chatEndRef} />
          </div>
          <div className="suggestion-list"><button onClick={() => setChatInput("Help me plan a focused, balanced day.")}><Sparkles size={14} /> Plan my day</button><button onClick={() => setChatInput("How can I make time for deep work?")}><Clock3 size={14} /> Find focus time</button></div>
          <form className="chat-composer" onSubmit={sendMessage}>
            <textarea value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} placeholder="Ask anything about your schedule…" rows={2} aria-label="Message the AI assistant" />
            <div className="composer-bottom"><span><ShieldCheck size={13} /> Your model, your choice</span><button className="send-button" type="submit" disabled={!chatInput.trim() || sending} aria-label="Send message">{sending ? <RefreshCw size={16} className="spin" /> : <Send size={16} />}</button></div>
          </form>
          <p className="assistant-footnote">Signed in as {user.email}. AI can make mistakes; review important plans.</p>
        </aside>
      </section>

      {showOnboarding && <div className="modal-backdrop onboarding-backdrop" role="presentation">
        <section className="onboarding-modal" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
          <div className="onboarding-top"><div className="onboarding-mark"><CalendarDays size={24} /></div><span>YOUR SETUP GUIDE</span><button className="onboarding-skip" onClick={() => { try { localStorage.setItem("smart-calendar-onboarding-done", "yes"); } catch {} setShowOnboarding(false); }}>Skip for now</button></div>
          <div className="onboarding-progress"><span className={onboardingStep >= 0 ? "done" : ""}></span><span className={onboardingStep >= 1 ? "done" : ""}></span><span className={onboardingStep >= 2 ? "done" : ""}></span></div>
          {onboardingStep === 0 ? <><p className="onboarding-eyebrow">WELCOME TO SMART CALENDAR</p><h2 id="onboarding-title">Your calendar, with a little help from AI.</h2><p className="onboarding-intro">Let’s set up your calendar and AI assistant in a few simple steps. You can finish setup now or return to this guide any time using the help icon.</p><div className="onboarding-choice"><div className="onboarding-choice-icon"><CalendarDays size={20}/></div><div><strong>1. Connect Google Calendar</strong><p>Sync your real events after Google Calendar authorization is configured for this app.</p><span className={accessToken ? "setup-status setup-ready" : "setup-status"}>{accessToken ? "Google Calendar connected" : GOOGLE_CLIENT_ID ? "Ready to connect" : "Setup is being finalized"}</span></div></div><div className="onboarding-choice"><div className="onboarding-choice-icon ai"><Sparkles size={20}/></div><div><strong>2. Connect your AI assistant</strong><p>Add an OpenAI-compatible provider URL, API key, and model name, then test the connection.</p><span className={isConfigured ? "setup-status setup-ready" : "setup-status"}>{isConfigured ? "AI settings already entered" : "Usually takes a minute"}</span></div></div><div className="onboarding-actions"><button className="primary-button onboarding-primary" onClick={() => setOnboardingStep(1)}>Let’s get started <ArrowRight size={16}/></button><span>About 3 minutes</span></div></> :
          onboardingStep === 1 ? <><p className="onboarding-eyebrow">STEP 1 OF 2</p><h2 id="onboarding-title">Connect Google Calendar</h2><p className="onboarding-intro">No long setup for you. Just connect your Google account and approve access so Smart Calendar can sync your schedule.</p><div className="onboarding-choice"><div className="onboarding-choice-icon"><CalendarDays size={20}/></div><div><strong>One secure connection</strong><p>Click Connect Google Calendar, select your Google account, and review the permission screen. Your events will then appear in this calendar.</p></div></div>{!GOOGLE_CLIENT_ID && <div className="onboarding-security"><ShieldCheck size={17}/><span>The site's Google connection is still being configured. You will be able to connect as soon as it is enabled.</span></div>}<div className="onboarding-actions"><button className="secondary-button" onClick={() => setOnboardingStep(0)}>Back</button><button className="secondary-button" onClick={() => { try { localStorage.setItem("smart-calendar-onboarding-done", "yes"); } catch {} setShowOnboarding(false); setGoogleError(""); startGoogleConnect(); }}><CalendarDays size={16}/> Connect Google Calendar</button><button className="primary-button onboarding-primary" onClick={() => setOnboardingStep(2)}>Next: AI assistant <ArrowRight size={16}/></button></div></> :
          <><p className="onboarding-eyebrow">STEP 2 OF 2</p><h2 id="onboarding-title">Connect your AI assistant</h2><p className="onboarding-intro">Use any provider that supports the OpenAI-compatible Chat Completions API.</p><ol className="onboarding-steps"><li><strong>Choose your API provider</strong><p>Get an API key and the exact model ID from your provider.</p></li><li><strong>Enter the connection details</strong><p>Open AI settings and fill in Base URL, API key, and Model name. For OpenAI, the base URL is <code>https://api.openai.com/v1</code>.</p></li><li><strong>Test, then save</strong><p>Choose “Test connection.” If it succeeds, select “Save settings” and send a message in the assistant panel.</p></li></ol><div className="onboarding-security"><ShieldCheck size={17}/><span>This prototype stores the API key in this browser and sends requests directly to your provider. For a public production app, use a secure backend.</span></div><div className="onboarding-actions"><button className="secondary-button" onClick={() => setOnboardingStep(1)}>Back</button><button className="secondary-button" onClick={() => { setShowOnboarding(false); setShowSettings(true); }}>Open AI settings <Settings2 size={16}/></button><button className="primary-button onboarding-primary" onClick={() => { try { localStorage.setItem("smart-calendar-onboarding-done", "yes"); } catch {} setShowOnboarding(false); }}>Finish setup <Check size={16}/></button></div></>}
        </section>
      </div>}
      {showSettings && <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setShowSettings(false); }}>
        <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <div className="modal-header"><div className="modal-heading-icon"><Bot size={20} /></div><div><h2 id="settings-title">Connect your AI model</h2><p>Use any provider with an OpenAI-compatible chat completions API.</p></div><IconButton title="Close settings" onClick={() => setShowSettings(false)}><X size={19} /></IconButton></div>
          <form onSubmit={saveConfig} className="settings-form">
            <label>Base URL <span>Required</span><input value={config.baseUrl} onChange={e => setConfig(p => ({ ...p, baseUrl: e.target.value }))} placeholder="https://api.openai.com/v1" autoComplete="url" required /><small>Enter the provider base URL; /chat/completions is added automatically.</small></label>
            <label>API key <span>{apiKeyConfigured ? "Saved securely" : "Required"}</span><div className="secret-input"><input type={showApiKey ? "text" : "password"} value={config.apiKey} onChange={e => setConfig(p => ({ ...p, apiKey: e.target.value }))} placeholder={apiKeyConfigured ? "Leave blank to keep the saved key" : "Enter your provider API key"} autoComplete="off" required={!apiKeyConfigured} /><IconButton title={showApiKey ? "Hide API key" : "Show API key"} onClick={() => setShowApiKey(v => !v)}>{showApiKey ? <EyeOff size={17} /> : <Eye size={17} />}</IconButton></div><small>{apiKeyConfigured ? "Your key is encrypted on the server. Leave blank to keep it, or enter a new key to replace it." : "Your key is sent over HTTPS and encrypted by the account server before storage."}</small></label>
            <label>Model name <span>Required</span><input value={config.model} onChange={e => setConfig(p => ({ ...p, model: e.target.value }))} placeholder="e.g. gpt-4o-mini" autoComplete="off" required /><small>Use the exact model ID supported by your provider.</small></label>
            {testMessage && <div className={"test-message " + (testState === "error" ? "test-error" : testState === "success" ? "test-success" : "")}>{testState === "success" ? <Check size={16} /> : testState === "error" ? <CircleHelp size={16} /> : <MessageSquare size={16} />}<span>{testMessage}</span></div>}
            <div className="security-note"><ShieldCheck size={17} /><span><strong>Private to your account</strong> — your key is stored encrypted on the server and only used by your own AI requests. It is never sent back to the browser after saving.</span></div>
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={testConnection} disabled={testState === "testing"}>{testState === "testing" ? <RefreshCw size={16} className="spin" /> : <Zap size={16} />} Test connection</button><button type="submit" className="primary-button"><Check size={16} /> Save settings</button></div>
          </form>
        </section>
      </div>}

      {showEventModal && <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setShowEventModal(false); }}>
        <section className="event-modal" role="dialog" aria-modal="true" aria-labelledby="event-title">
          <div className="event-modal-top"><span>{editingEventId ? "EDIT EVENT" : "NEW EVENT"}</span><IconButton title="Close event form" onClick={() => { setShowEventModal(false); setEditingEventId(null); }}><X size={19} /></IconButton></div>
          <form onSubmit={saveEvent} className="event-form">
            <input id="event-title" className="event-title-input" value={draft.title} onChange={e => setDraft(p => ({ ...p, title: e.target.value }))} placeholder="Add a title" autoFocus required />
            <label className="event-field"><CalendarDays size={18} /><input type="date" value={draft.date} onChange={e => setDraft(p => ({ ...p, date: e.target.value }))} required /></label>
            <label className="event-field"><Clock3 size={18} /><div className="event-times"><input type="time" value={draft.start} onChange={e => setDraft(p => ({ ...p, start: e.target.value }))} required /><span>to</span><input type="time" value={draft.end} onChange={e => setDraft(p => ({ ...p, end: e.target.value }))} required /></div></label>
            <label className="event-field"><ListTodo size={18} /><input value={draft.place} onChange={e => setDraft(p => ({ ...p, place: e.target.value }))} placeholder="Add notes (optional)" /></label>
            <div className="color-choice"><span>Event color</span>{COLORS.map(color => <button type="button" key={color} aria-label={"Use color " + color} className={draft.color === color ? "color-selected" : ""} style={{ backgroundColor: color }} onClick={() => setDraft(p => ({ ...p, color }))}>{draft.color === color && <Check size={13} />}</button>)}</div>
            <div className="event-modal-actions"><button type="button" className="secondary-button" onClick={() => { setShowEventModal(false); setEditingEventId(null); }}>Cancel</button><button type="submit" className="primary-button"><Check size={16} /> {editingEventId ? "Save changes" : accessToken ? "Save to Google Calendar" : "Save event"}</button></div>
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
