import "dotenv/config";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import nodemailer from "nodemailer";
import pg from "pg";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3001);
const isProduction = process.env.NODE_ENV === "production";
const cookieName = "smart_calendar_session";
const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;
const scrypt = promisify(crypto.scrypt);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 8_000
});

function allowedOrigins() {
  return (process.env.FRONTEND_ORIGINS || process.env.FRONTEND_URL || "http://localhost:5173")
    .split(",").map(value => value.trim().replace(/\/$/, "")).filter(Boolean);
}
function apiError(res, status, message) {
  return res.status(status).json({ error: message });
}
function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function newSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}
function constantTimeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function encryptionKey() {
  const raw = (process.env.APP_ENCRYPTION_KEY || "").trim();
  if (!/^[a-f0-9]{64}$/i.test(raw)) {
    throw new Error("APP_ENCRYPTION_KEY must be a 64-character hexadecimal string. Generate one with: openssl rand -hex 32");
  }
  return Buffer.from(raw, "hex");
}
function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64")
  };
}
function decryptSecret(row) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(row.api_key_iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(row.api_key_tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(row.api_key_ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8");
}
function publicUser(row) {
  return { id: row.id, email: row.email, emailVerifiedAt: row.email_verified_at };
}
function setSessionCookie(res, token) {
  res.cookie(cookieName, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: process.env.COOKIE_SAME_SITE || "lax",
    maxAge: sessionTtlMs,
    path: "/"
  });
}
function clearSessionCookie(res) {
  res.clearCookie(cookieName, {
    httpOnly: true,
    secure: isProduction,
    sameSite: process.env.COOKIE_SAME_SITE || "lax",
    path: "/"
  });
}
function createMailer() {
  const user = process.env.SMTP_USER;
  const pass = (process.env.SMTP_APP_PASSWORD || "").replace(/\s/g, "");
  if (!user || !pass) {
    const error = new Error("Email verification is not configured on the server. Set SMTP_USER and SMTP_APP_PASSWORD in the server environment.");
    error.status = 503;
    throw error;
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: { user, pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000
  });
}
async function sendVerificationEmail(email, token) {
  const frontend = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
  const link = frontend + "/?verify=" + encodeURIComponent(token);
  const transporter = createMailer();
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    to: email,
    subject: "Verify your Smart Calendar account",
    text: [
      "Welcome to Smart Calendar.",
      "",
      "Verify your email address by opening this link:",
      link,
      "",
      "This link expires in 30 minutes. If you did not create this account, you can ignore this message."
    ].join("\n"),
    html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:32px auto;padding:28px;border:1px solid #e8e8f2;border-radius:16px;color:#303147"><h1 style="font-size:23px">Welcome to Smart Calendar</h1><p>Confirm your email address to activate your account.</p><p style="margin:28px 0"><a href="${link}" style="background:#686acf;color:white;padding:12px 18px;border-radius:9px;text-decoration:none;font-weight:700">Verify email</a></p><p style="font-size:12px;color:#85869b">This link expires in 30 minutes. If you didn't create an account, ignore this email.</p></div>`
  });
}
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${Buffer.from(key).toString("base64url")}`;
}
async function verifyPassword(password, encoded) {
  const [algorithm, saltText, hashText] = String(encoded || "").split("$");
  if (algorithm !== "scrypt" || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, "base64url");
  const actual = Buffer.from(await scrypt(password, Buffer.from(saltText, "base64url"), expected.length));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
function normaliseEmail(value) {
  return String(value || "").trim().toLowerCase();
}
function validEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function validateAIBaseUrl(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw new Error("Enter a valid AI provider Base URL."); }
  if (url.username || url.password || url.search || url.hash) throw new Error("The Base URL must not contain credentials, query parameters, or fragments.");
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  const isLocal = localHosts.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && !isProduction && isLocal)) {
    throw new Error("Use an HTTPS Base URL for AI providers (HTTP is allowed only for localhost during development).");
  }
  const host = url.hostname.toLowerCase();
  const allowedDevLoopback = !isProduction && url.protocol === "http:" && isLocal;
  const privateAddress =
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host) ||
    /^0\./.test(host) || host === "0.0.0.0" ||
    host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80") ||
    host === "metadata.google.internal" || host.endsWith(".local") || host.endsWith(".localhost");
  if ((isLocal && !allowedDevLoopback) || (privateAddress && !allowedDevLoopback)) {
    throw new Error("Private or loopback network addresses are not allowed as AI provider URLs.");
  }
  return url.toString().replace(/\/$/, "");
}
function chatEndpoint(baseUrl) {
  const base = validateAIBaseUrl(baseUrl);
  return /\/chat\/completions$/i.test(base) ? base : base + "/chat/completions";
}
async function getAISettings(userId) {
  const result = await pool.query("SELECT base_url, model, api_key_ciphertext, api_key_iv, api_key_tag FROM ai_settings WHERE user_id = $1", [userId]);
  return result.rows[0] || null;
}
async function resolveAIConfig(userId, overrides = {}, allowUnsavedKey = false) {
  const saved = await getAISettings(userId);
  const baseUrl = String(overrides.baseUrl || saved?.base_url || "").trim();
  const model = String(overrides.model || saved?.model || "").trim();
  let apiKey = "";
  if (allowUnsavedKey && String(overrides.apiKey || "").trim()) {
    apiKey = String(overrides.apiKey).trim();
  } else if (saved?.api_key_ciphertext) {
    apiKey = decryptSecret(saved);
  }
  if (!baseUrl || !model || !apiKey) {
    const error = new Error("Set your Base URL, model, and API key in AI settings first.");
    error.status = 400;
    throw error;
  }
  return { baseUrl: validateAIBaseUrl(baseUrl), model, apiKey };
}
async function askAI(config, messages) {
  const response = await fetch(chatEndpoint(config.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + config.apiKey
    },
    body: JSON.stringify({ model: config.model, messages, temperature: 0.7 }),
    signal: AbortSignal.timeout(35_000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(String(data?.error?.message || data?.message || `AI provider returned HTTP ${response.status}`).slice(0, 500));
    error.status = 502;
    throw error;
  }
  return data;
}

app.disable("x-powered-by");
if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins().includes(origin.replace(/\/$/, ""))) return callback(null, true);
    return callback(new Error("This website origin is not allowed by the API CORS policy."));
  },
  credentials: true
}));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use((req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    const origin = req.get("origin");
    if (origin && !allowedOrigins().includes(origin.replace(/\/$/, ""))) {
      return apiError(res, 403, "Request origin is not allowed.");
    }
  }
  next();
});
app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false }));
app.use("/api/ai", rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false }));

async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.[cookieName];
    if (!token) return apiError(res, 401, "Please sign in to continue.");
    const found = await pool.query(
      "SELECT u.id, u.email, u.email_verified_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > NOW()",
      [sha256(token)]
    );
    if (!found.rowCount) {
      clearSessionCookie(res);
      return apiError(res, 401, "Your session has expired. Please sign in again.");
    }
    req.user = publicUser(found.rows[0]);
    next();
  } catch (error) { next(error); }
}

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "smart-calendar-api" }));

app.post("/api/auth/register", async (req, res, next) => {
  const email = normaliseEmail(req.body?.email);
  const password = String(req.body?.password || "");
  if (!validEmail(email)) return apiError(res, 400, "Enter a valid email address.");
  if (password.length < 10 || password.length > 200) return apiError(res, 400, "Use a password between 10 and 200 characters.");
  const userId = crypto.randomUUID();
  const token = newSecret();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const duplicate = await client.query("SELECT id FROM users WHERE email = $1", [email]);
    if (duplicate.rowCount) {
      await client.query("ROLLBACK");
      return apiError(res, 409, "An account with this email already exists. Try signing in instead.");
    }
    const passwordHash = await hashPassword(password);
    await client.query(
      "INSERT INTO users (id, email, password_hash, verification_token_hash, verification_expires_at) VALUES ($1, $2, $3, $4, NOW() + INTERVAL '30 minutes')",
      [userId, email, passwordHash, sha256(token)]
    );
    await client.query("COMMIT");
    try {
      await sendVerificationEmail(email, token);
    } catch (mailError) {
      await pool.query("DELETE FROM users WHERE id = $1 AND email_verified_at IS NULL", [userId]);
      return apiError(res, mailError.status || 503, "We could not send your verification email. Check the SMTP configuration on the server and try again.");
    }
    return res.status(201).json({ message: "Check your inbox for a verification link. The link expires in 30 minutes." });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") return apiError(res, 409, "An account with this email already exists.");
    next(error);
  } finally { client.release(); }
});

app.post("/api/auth/verify-email", async (req, res, next) => {
  try {
    const token = String(req.body?.token || "");
    if (token.length < 20 || token.length > 300) return apiError(res, 400, "This verification link is invalid or expired.");
    const result = await pool.query(
      "UPDATE users SET email_verified_at = NOW(), verification_token_hash = NULL, verification_expires_at = NULL WHERE verification_token_hash = $1 AND verification_expires_at > NOW() AND email_verified_at IS NULL RETURNING id, email, email_verified_at",
      [sha256(token)]
    );
    if (!result.rowCount) return apiError(res, 400, "This verification link is invalid or expired. Request a new verification email.");
    return res.json({ message: "Email verified. You can now sign in.", user: publicUser(result.rows[0]) });
  } catch (error) { next(error); }
});

app.post("/api/auth/resend-verification", async (req, res, next) => {
  try {
    const email = normaliseEmail(req.body?.email);
    if (!validEmail(email)) return apiError(res, 400, "Enter a valid email address.");
    const found = await pool.query("SELECT id, email, email_verified_at FROM users WHERE email = $1", [email]);
    if (!found.rowCount || found.rows[0].email_verified_at) {
      return res.json({ message: "If the account needs verification, an email will be sent." });
    }
    const token = newSecret();
    await pool.query(
      "UPDATE users SET verification_token_hash = $2, verification_expires_at = NOW() + INTERVAL '30 minutes' WHERE id = $1",
      [found.rows[0].id, sha256(token)]
    );
    await sendVerificationEmail(email, token);
    return res.json({ message: "If the account needs verification, an email will be sent." });
  } catch (error) { next(error); }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const email = normaliseEmail(req.body?.email);
    const password = String(req.body?.password || "");
    if (!validEmail(email) || !password) return apiError(res, 400, "Enter your email and password.");
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (!result.rowCount || !(await verifyPassword(password, result.rows[0].password_hash))) {
      return apiError(res, 401, "Email or password is incorrect.");
    }
    const user = result.rows[0];
    if (!user.email_verified_at) return apiError(res, 403, "Verify your email before signing in. You can request a new verification email.");
    const token = newSecret();
    const expiresAt = new Date(Date.now() + sessionTtlMs);
    await pool.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [sha256(token), user.id, expiresAt]);
    setSessionCookie(res, token);
    return res.json({ user: publicUser(user) });
  } catch (error) { next(error); }
});

app.get("/api/auth/me", requireAuth, (req, res) => res.json({ user: req.user }));

app.post("/api/auth/logout", requireAuth, async (req, res, next) => {
  try {
    const token = req.cookies?.[cookieName];
    await pool.query("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]);
    clearSessionCookie(res);
    return res.json({ message: "Signed out." });
  } catch (error) { next(error); }
});

app.get("/api/events", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT id, title, start_at, end_at, color, place FROM user_events WHERE user_id = $1 ORDER BY start_at ASC",
      [req.user.id]
    );
    return res.json({ events: result.rows.map(row => ({
      id: row.id, title: row.title, start: row.start_at, end: row.end_at, color: row.color, place: row.place, source: "local"
    })) });
  } catch (error) { next(error); }
});

app.put("/api/events", requireAuth, async (req, res, next) => {
  const events = req.body?.events;
  if (!Array.isArray(events) || events.length > 1000) return apiError(res, 400, "Events must be an array of no more than 1,000 items.");
  const normalised = [];
  for (const event of events) {
    const title = String(event?.title || "").trim().slice(0, 240);
    const start = new Date(event?.start);
    const end = new Date(event?.end);
    if (!event?.id || String(event.id).length > 100 || !title || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return apiError(res, 400, "One or more events have invalid fields or times.");
    }
    normalised.push({
      id: String(event.id), title, start, end,
      color: /^#[0-9a-f]{6}$/i.test(String(event.color || "")) ? String(event.color) : "#6d72d9",
      place: String(event.place || "").slice(0, 2000)
    });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM user_events WHERE user_id = $1", [req.user.id]);
    for (const event of normalised) {
      await client.query(
        "INSERT INTO user_events (id, user_id, title, start_at, end_at, color, place) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [event.id, req.user.id, event.title, event.start, event.end, event.color, event.place]
      );
    }
    await client.query("COMMIT");
    return res.json({ saved: normalised.length });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally { client.release(); }
});

app.get("/api/ai/settings", requireAuth, async (req, res, next) => {
  try {
    const row = await getAISettings(req.user.id);
    return res.json({
      baseUrl: row?.base_url || "https://api.openai.com/v1",
      model: row?.model || "",
      apiKeyConfigured: Boolean(row?.api_key_ciphertext)
    });
  } catch (error) { next(error); }
});

app.put("/api/ai/settings", requireAuth, async (req, res, next) => {
  try {
    const baseUrl = validateAIBaseUrl(req.body?.baseUrl);
    const model = String(req.body?.model || "").trim();
    const apiKey = String(req.body?.apiKey || "").trim();
    if (!model || model.length > 200) return apiError(res, 400, "Enter a valid model name.");
    const existing = await getAISettings(req.user.id);
    let encrypted;
    if (apiKey) encrypted = encryptSecret(apiKey);
    else if (existing?.api_key_ciphertext) encrypted = {
      ciphertext: existing.api_key_ciphertext, iv: existing.api_key_iv, tag: existing.api_key_tag
    };
    else return apiError(res, 400, "Enter your API key before saving settings.");
    await pool.query(
      `INSERT INTO ai_settings (user_id, base_url, model, api_key_ciphertext, api_key_iv, api_key_tag, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (user_id) DO UPDATE SET base_url = EXCLUDED.base_url, model = EXCLUDED.model,
       api_key_ciphertext = EXCLUDED.api_key_ciphertext, api_key_iv = EXCLUDED.api_key_iv, api_key_tag = EXCLUDED.api_key_tag, updated_at = NOW()`,
      [req.user.id, baseUrl, model, encrypted.ciphertext, encrypted.iv, encrypted.tag]
    );
    return res.json({ baseUrl, model, apiKeyConfigured: true, message: "AI settings saved to your account." });
  } catch (error) {
    if (error.status) return apiError(res, error.status, error.message);
    next(error);
  }
});

app.post("/api/ai/test", requireAuth, async (req, res, next) => {
  try {
    const config = await resolveAIConfig(req.user.id, req.body || {}, true);
    const data = await askAI(config, [{ role: "user", content: "Reply with only: Connected" }]);
    const reply = data?.choices?.[0]?.message?.content;
    if (!reply) return apiError(res, 502, "The AI provider returned no assistant message.");
    return res.json({ ok: true, message: "Connection successful. Your model replied to the test request." });
  } catch (error) {
    return apiError(res, error.status || 502, error.message || "Could not reach the AI provider.");
  }
});

app.post("/api/ai/chat", requireAuth, async (req, res, next) => {
  try {
    const messages = req.body?.messages;
    if (!Array.isArray(messages) || messages.length < 1 || messages.length > 60) {
      return apiError(res, 400, "Send between 1 and 60 chat messages.");
    }
    const safeMessages = [];
    for (const message of messages) {
      if (!["system", "user", "assistant"].includes(message?.role) || typeof message?.content !== "string" || message.content.length > 20_000) {
        return apiError(res, 400, "One or more chat messages are invalid.");
      }
      safeMessages.push({ role: message.role, content: message.content });
    }
    const config = await resolveAIConfig(req.user.id);
    const data = await askAI(config, safeMessages);
    const answer = data?.choices?.[0]?.message?.content;
    if (!answer) return apiError(res, 502, "The AI provider returned no assistant message.");
    return res.json({ content: typeof answer === "string" ? answer : JSON.stringify(answer) });
  } catch (error) {
    return apiError(res, error.status || 502, error.message || "Could not reach your AI provider.");
  }
});

app.use((err, _req, res, _next) => {
  const status = Number(err.status) || 500;
  if (status >= 500) console.error("Smart Calendar API error:", err.message);
  if (res.headersSent) return;
  return apiError(res, status, status >= 500 ? "The server could not complete this request." : err.message);
});

const schema = await readFile(path.join(__dirname, "schema.sql"), "utf8");
await pool.query(schema);
const server = app.listen(port, () => {
  console.log(`Smart Calendar API listening on port ${port}`);
});
server.requestTimeout = 45_000;
server.headersTimeout = 50_000;

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

