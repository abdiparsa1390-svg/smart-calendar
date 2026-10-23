# Smart Calendar

A local-first calendar with a required, tested AI planning assistant and Google Calendar connection before the workspace unlocks.

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

## First-run setup

The calendar remains locked until setup is completed in this order:

1. Choose English or Persian.
2. Connect Google Calendar and pass a real Calendar API access check.
3. Configure one or more AI providers and pass the live response test.
4. Complete the AI-led interview about goals, routines, constraints, and preferences.
5. Review the categorized Markdown memory files and explicitly approve saving them.

The assistant continues in the selected language. It can propose calendar changes and memory updates, but both require explicit user approval before they are applied.

## AI providers, fallback, and proxy

Add multiple OpenAI-compatible providers. Smart Calendar tests them in order and automatically tries the next enabled provider if a request fails, is rate-limited, or returns an invalid response. Each provider has its own Base URL, model ID, API key, and optional HTTP/HTTPS proxy URL.

In the local package, AI keys are encrypted at rest with AES-256-GCM; they are not returned to the browser. Local proxy URLs are supported for local networking. The hosted API blocks private/loopback proxy targets to reduce server-side request risks.

This local package does not use a shared server API and does not give every user a shared quota. If you want users to rely on one API key owned and paid for by the project publisher, that requires a centrally hosted backend with budgets, usage limits, and abuse prevention.

## Privacy and data

- No account or external database is required for the local package.
- Calendar events and AI settings stay in the local data folder.
- Approved local Markdown files are stored under .smart-calendar/memory/.
- The server binds to 127.0.0.1 and rejects cross-origin requests.
- AI keys are encrypted on disk; keep the encryption.key file private.
- Google access tokens are kept in session memory and are not written to disk.
- Calendar changes and memory updates require explicit approval.
- Messages are sent to the AI provider that the user configures.

Back up the .smart-calendar folder to preserve events and settings. Losing encryption.key means a saved AI key cannot be decrypted.

## Google Calendar

Google Calendar connection is mandatory before the workspace unlocks. The publisher must create a valid Google OAuth Client ID, enable Google Calendar API, and authorize all app origins in Google Cloud:

- http://127.0.0.1:4178
- http://localhost:4178
- https://abdiparsa1390-svg.github.io (for the GitHub Pages frontend)

For GitHub Actions builds, add repository variable GOOGLE_CLIENT_ID under **Settings → Secrets and variables → Actions → Variables**. If it is missing or invalid, Google authorization will not work and setup must remain locked. Do not put the OAuth client secret in frontend variables; the browser OAuth client ID is a public identifier.

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
