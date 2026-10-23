# Smart Calendar

A calendar workspace with an AI assistant, individual accounts, email verification, and per-user settings.

## Features

- Email/password registration, email verification, sign-in, and sign-out.
- PostgreSQL-backed accounts and calendar events, separated by user.
- Each account has its own OpenAI-compatible API Base URL, model, and API key.
- AI API keys are encrypted with AES-256-GCM on the backend and are never returned to the browser after saving.
- AI chat and connection tests go through the authenticated backend rather than exposing the API key in browser requests.
- Gmail SMTP verification emails are sent by the backend using environment variables only.
- Google Calendar OAuth integration is optional and uses the site's OAuth Client ID, not an ID entered by every user.

## Important hosting note

GitHub Pages can host the frontend only. It cannot run the Express backend, access PostgreSQL, or send verification emails. The account and email features become functional only after the backend is running and the frontend is configured with its API URL. The repository contains both the frontend and the backend so they can be deployed together when you move to a server.

For a production deployment, hosting the frontend and API on the same site/domain (for example, `app.example.com` and `app.example.com/api` behind a reverse proxy) is recommended. If they are on separate sites, configure the API origin and secure cross-site cookies carefully; some browsers block third-party cookies.

## Local development on Windows

You need Node.js 20+, PostgreSQL, and a newly generated Gmail App Password (or preferably a configured Gmail OAuth 2.0 SMTP transport for a production service).

1. Start a local PostgreSQL database (Docker required for this command):

   ```cmd
   docker compose up -d postgres
   ```

   Or create a PostgreSQL database named `smart_calendar` yourself, then update the database URL if needed.
2. Copy `server/.env.example` to `server/.env`:

   ```cmd
   copy server\.env.example server\.env
   ```

3. Edit `server/.env`. Set `DATABASE_URL`, `SMTP_USER`, `SMTP_APP_PASSWORD`, `EMAIL_FROM`, and `FRONTEND_URL`. Generate an encryption key with:

   ```cmd
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Put the resulting 64-character hex value in `APP_ENCRYPTION_KEY`. Keep this value stable and private: losing it prevents previously encrypted API keys from being decrypted.

4. Install dependencies and start the front end and API:

   ```cmd
   npm install
   npm --prefix server install
   npm run dev:all
   ```

5. Open `http://localhost:5173`. The API listens on port 3001 and the Vite development server proxies `/api` to it. On first run, the API creates its tables in the configured PostgreSQL database.

For Gmail SMTP, use `smtp.gmail.com` with port `587` and STARTTLS. Put the App Password in `server/.env` only; never commit it or add it to frontend build variables. Gmail App Passwords require 2-Step Verification and should be revoked if exposed. For more serious public use, prefer OAuth 2.0 or a transactional email provider rather than a personal Gmail mailbox.

## Deploying

Deploy the `server/` directory to a Node.js hosting service with a PostgreSQL database. Configure the environment variables from `server/.env.example` in that service's private environment, and set:

- `FRONTEND_URL`: the public frontend URL including the app path, for verification links.
- `FRONTEND_ORIGINS`: the exact browser origin(s), comma-separated, with no paths.
- `COOKIE_SAME_SITE`: `lax` when frontend and API are same-site; for cross-site hosting it may need to be `none` with HTTPS enabled.
- `TRUST_PROXY=true` when using a trusted reverse proxy.

In GitHub repository **Settings → Secrets and variables → Actions → Variables**, set `API_BASE_URL` to the public API base URL (for example, `https://api.example.com`). The workflow injects it as `VITE_API_BASE_URL` during the frontend build. Also configure `GOOGLE_CLIENT_ID` there if you use the Google Calendar integration. Do not put SMTP credentials, database passwords, encryption keys, AI keys, or Google client secrets in GitHub Actions variables; keep server secrets in the backend host's secret/environment manager.

## Google Calendar

The browser frontend uses the configured site OAuth Client ID to start Google authorization. Configure the OAuth consent screen and Authorized JavaScript origin in Google Cloud, enable Google Calendar API, and follow Google's requirements for testing/publishing calendar scopes. Users should only have to click **Connect Google** and approve access; they should not have to create their own OAuth client.

## Authentication and data model

- Passwords are hashed with Node.js scrypt; passwords are never stored in plaintext.
- Verification and session tokens are random and stored only as SHA-256 hashes.
- Sessions use an HTTP-only cookie and are stored in PostgreSQL.
- Individual AI API keys are encrypted at rest using AES-256-GCM.
- Account-scoped settings and events are isolated by authenticated user ID.
- Email verification tokens expire after 30 minutes; sign-in is blocked until verification succeeds.

This is a starting point, not a completed production SaaS security audit. Before public launch, add account recovery, monitoring, automated tests, backup/restore procedures, email delivery monitoring, and review the deployment cookie/CORS configuration.
