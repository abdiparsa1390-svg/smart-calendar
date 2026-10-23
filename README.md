# Smart Calendar

A local-first calendar with an optional AI planning assistant.

## Install and run

Requires Node.js 20 or newer. After the package has been published to npm, install it globally:

~~~bash
npm install -g smart-calendar
smart-calendar
~~~

On Windows, open CMD or PowerShell. The command starts a private local server and opens http://127.0.0.1:4178 in your browser. Keep the terminal open while using the app; press Ctrl+C to stop it.

No account, cloud API server, PostgreSQL database, or email verification is required. Each person runs their own copy on their computer. Events and settings are stored in the user's home folder under .smart-calendar. The web server binds to 127.0.0.1 and is not exposed to the local network.

## Commands

~~~bash
smart-calendar --help
smart-calendar --no-open
smart-calendar --port 4180
smart-calendar --data-dir "D:\MyCalendarData"
~~~

## AI assistant

The calendar works without an AI provider. To use the AI assistant, open AI settings and enter an OpenAI-compatible HTTPS Base URL, model ID, and an API key from a provider you have access to. The key is encrypted locally with AES-256-GCM and is not returned to the browser. AI requests go from the local Node.js process to the provider configured by that user.

This local package does not use a shared server API and does not give every user a shared quota. If you want users to rely on one API key owned and paid for by the project publisher, the architecture must instead include a centrally hosted backend, budgets, usage limits, and abuse prevention.

## Privacy and data

- No account or external database is required for the local package.
- Calendar events and AI settings stay in the local data folder.
- The server binds to 127.0.0.1 and rejects cross-origin requests.
- AI keys are encrypted on disk; keep the encryption.key file private.
- Messages are sent to the AI provider that the user configures.

Back up the .smart-calendar folder to preserve events and settings. Losing encryption.key means a saved AI key cannot be decrypted.

## Google Calendar

Google Calendar integration is optional and needs the publisher to configure a Google OAuth client ID, enable Google Calendar API, and authorize the local origin in Google Cloud. The calendar's local features work even without Google OAuth setup.

## For maintainers

Build and pack the installable CLI:

~~~bash
npm install
npm pack
~~~

npm pack runs the prepack script, builds the frontend in local mode, and creates a .tgz package. Before the first public release, the publisher must have an npm account, confirm the unscoped name smart-calendar is available, and publish the package. It is not available through npm install -g until that publishing step is done.


## Publish a public npm release

The repository includes a manual GitHub Actions workflow named **Publish Smart Calendar to npm**. To use it:

1. Create or sign in to your npm account and verify that the unscoped package name **smart-calendar** is available. If another publisher already owns that name, choose another package name before publishing.
2. Create an npm access token permitted to publish packages. Add it to GitHub under **Settings → Secrets and variables → Actions** as a repository secret named **NPM_TOKEN**.
3. Open **Actions → Publish Smart Calendar to npm → Run workflow**, type **PUBLISH** in the confirmation field, and run it.
4. After the first successful publish, users can run npm install -g smart-calendar and then smart-calendar.

Publishing version 0.1.0 can happen only once. For later releases, update the version in package.json before publishing again. Do not commit the NPM_TOKEN or any AI provider keys to the repository.

Repository: https://github.com/abdiparsa1390-svg/smart-calendar
