# Smart Calendar

A calendar workspace with an AI chat panel beside it. This is the first UI prototype; the assistant's calendar workflow will be defined in a later iteration.

## Features in this prototype

- Week, day, and month calendar views.
- Add calendar events with a title, date, time, notes, and color.
- OpenAI-compatible chat completions configuration: Base URL, API key, and model ID.
- Test the model connection and chat with the configured model.
- Calendar events and API settings are saved in the current browser.

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

## Configure the AI provider

Open **AI settings** in the assistant panel and enter:

- **Base URL** — for example, `https://api.openai.com/v1`, or your compatible provider's base URL.
- **API key** — the credential issued by your provider.
- **Model name** — the exact model ID supported by your provider.

The app sends a request to `/chat/completions` relative to the configured Base URL. Some API providers may block direct browser requests with CORS; a backend proxy may be required.

## Security note

This is a browser-only prototype. The API key is saved in local browser storage and requests are made directly from the browser, so a production deployment should use a backend service or server-side proxy to keep API credentials out of client code. Do not use a personal or sensitive API key in a public deployment.

The assistant currently has no tools to create, edit, or delete calendar events. Calendar-aware actions and the assistant's operating rules will be added after their behavior is specified.
