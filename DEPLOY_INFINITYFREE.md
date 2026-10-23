## Deploy to InfinityFree (PHP + MySQL)

This project also includes a PHP-compatible package for InfinityFree's free shared hosting. InfinityFree does not run the Express/Node.js server in server/; instead, the package in infinityfree/ implements the same account, email-verification, event storage, encrypted AI-key settings, and AI chat API with PHP, MySQL, OpenSSL, cURL, and PHPMailer.

1. Open the repository's **Actions** tab and run **Package Smart Calendar for InfinityFree** (or wait for the workflow after a push to main). Open the successful run, download the smart-calendar-infinityfree artifact, and extract the ZIP on your computer.
2. Create a MySQL database in the InfinityFree control panel. Import the included api/schema.sql file with phpMyAdmin.
3. In the upload package, copy api/config.example.php to api/config.php using InfinityFree's File Manager. Fill in the exact MySQL host/name/user/password from the control panel, the full HTTPS site URL, SMTP credentials, and a newly generated 64-character hex encryption key.
4. Upload the contents of the extracted package (including .htaccess, index.html, assets/, and api/) into the site's htdocs web root. Do not upload just the parent folder.
5. Visit https://YOUR-SITE/api/health. A successful setup returns JSON with "ok": true. Then open the site's root page and create an account; the verification email must arrive before sign-in is allowed.

For Gmail delivery, configure smtp.gmail.com, port 587, and a newly generated Google App Password. InfinityFree restricts PHP's built-in mail() function, so the PHP API uses PHPMailer over external SMTP. Do not reuse any password or app password that has previously been shared in a chat or committed to a repository. Generate the app password privately and put it only in api/config.php on your host.

Generate app_encryption_key locally in Windows CMD with:

~~~cmd
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
~~~

Keep that value private and stable. It encrypts per-user AI API keys at rest; changing it makes previously saved AI keys unreadable. Keep config.php off GitHub and never include it in a public ZIP. The workflow only packages config.example.php, which contains placeholders.

The frontend uses the same site origin for /api/... , so no separate Node.js host or API_BASE_URL is needed. If you want the one-click Google Calendar integration, set the repository Actions variable GOOGLE_CLIENT_ID and add the InfinityFree domain as an authorized JavaScript origin in Google Cloud. Google Calendar's consent-screen and API settings are still required.

The ZIP is a deployable starting point, not a substitute for testing on the actual host. After installation, test registration, verification email delivery, sign-in/out, creating/editing/deleting events, saving an AI API key, and sending an AI chat message.
