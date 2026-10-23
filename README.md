# Smart Calendar

A responsive calendar workspace with an AI chat panel beside it.

## Features

- Day, week, and month views.
- Create calendar events with a title, date, time, notes, and color.
- Click an event to edit it. Right-click on desktop or press and hold on touch devices to edit, delete, or open a Google event.
- Connect a Google account using Google Identity Services and the Google Calendar API. Events in the visible date range sync with your primary calendar; creating, editing, and deleting Google events writes back to Google Calendar.
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

## Connect Google Calendar

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a project, then enable **Google Calendar API** under APIs & Services → Library.
3. Configure the OAuth consent screen. If the app is in testing mode, add the Google account you will use as a test user.
4. Under APIs & Services → Credentials, create an **OAuth client ID** of type **Web application**.
5. Add the exact site origin shown in Smart Calendar's Google setup window to **Authorized JavaScript origins**. For local development, this is usually `http://localhost:5173`; for GitHub Pages, it is the origin `https://abdiparsa1390-svg.github.io` (not the full path with `/smart-calendar/`).
6. In Smart Calendar, choose **Connect Google**, paste the OAuth Client ID, select your account, and approve calendar access.

Only the OAuth Client ID belongs in this browser app. Never paste a Google Client Secret into the frontend. Google access tokens are held in memory and need to be requested again in a later session. The Google account must authorize the requested calendar events scope.

## Configure the AI provider

Open **AI settings** in the assistant panel and enter:

- **Base URL** — for example, `https://api.openai.com/v1`, or your compatible provider's base URL.
- **API key** — the credential issued by your provider.
- **Model name** — the exact model ID supported by your provider.

The app sends a request to `/chat/completions` relative to the configured Base URL. Some API providers may block direct browser requests through CORS; a backend proxy may be required.

## Security and limitations

This is a browser-only prototype. The AI API key is saved in local browser storage and requests are made directly from the browser; for a public production app, use a backend service or server-side proxy to keep AI API credentials out of client code. Do not use a personal or sensitive API key in a public deployment.

The AI chat can discuss scheduling, but it does not yet have tools to create, edit, or delete calendar events by conversation. Use the calendar interface for those changes.
