# Smart Calendar

A responsive calendar workspace with an AI chat panel beside it.

## Features

- Day, week, and month views.
- Create calendar events with a title, date, time, notes, and color.
- Click an event to edit it. Right-click on desktop or press and hold on touch devices to edit, delete, or open a Google event.
- One-click Google Calendar connection: users click **Connect Google**, choose their Google account, and approve access. No OAuth setup or Client ID entry is required from individual users.
- Google Calendar events sync for the visible date range; creating, editing, and deleting synced events writes back to Google Calendar.
- Configure any OpenAI-compatible Chat Completions provider using a Base URL, API key, and model ID.
- Local-only events and AI provider settings are saved in this browser.

## Run locally

Requires Node.js and npm.

```bash
npm install
npm run dev
```

Create a production build with:

```bash
npm run build
npm run preview
```

## One-time Google Calendar setup for the site owner

This setup is completed once for Smart Calendar, not by every user.

1. Open [Google Cloud Console](https://console.cloud.google.com/), create or select a project, and enable **Google Calendar API**.
2. Configure the OAuth consent screen. Add your own Google account as a test user while the app is in testing.
3. Under APIs & Services → Credentials, create an **OAuth Client ID** of type **Web application**.
4. Under **Authorized JavaScript origins**, add `https://abdiparsa1390-svg.github.io`. For local development, add `http://localhost:5173` as well if needed.
5. In this GitHub repository, open **Settings → Secrets and variables → Actions → Variables**. Create a repository variable named `GOOGLE_CLIENT_ID` and set its value to the OAuth Client ID. The Client ID is designed to be public in browser apps; do not add a Google Client Secret to the frontend.
6. Trigger **Build and publish Smart Calendar** from the Actions tab (or push a new commit) so the site is rebuilt with the setting.
7. For public use, review the OAuth consent-screen publishing and verification requirements for Google Calendar scopes. While the app remains in testing, only configured test users can connect.

After this one-time setup, the **Connect Google** button opens Google's account/permission flow directly. Users don't need to visit Google Cloud or enter any IDs.

## Configure the AI provider

Open **AI settings** in the assistant panel and enter:

- **Base URL** — for example, `https://api.openai.com/v1`, or your compatible provider's base URL.
- **API key** — the credential issued by your provider.
- **Model name** — the exact model ID supported by your provider.

The app sends a request to `/chat/completions` relative to the configured Base URL. Some API providers may block direct browser requests through CORS; a backend proxy may be required.

## Security and limitations

This is a browser-only prototype. The AI API key is saved in local browser storage and requests are made directly from the browser; for a public production app, use a backend service or server-side proxy to keep AI API credentials out of client code. Do not use a personal or sensitive API key in a public deployment.

Google OAuth access tokens are held in memory and need to be requested again in a later session. The AI chat can discuss scheduling, but it does not yet have tools to create, edit, or delete calendar events through conversation. Use the calendar interface for those changes.
