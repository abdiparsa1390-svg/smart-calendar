<?php
/*
 * Copy this file to config.php on the host, then replace every placeholder.
 * Never commit config.php or share its contents.
 */
return [
    // Use the exact host, database name, username, and password shown in InfinityFree's MySQL Databases panel.
    'db_host' => 'sqlXXX.infinityfree.com',
    'db_port' => 3306,
    'db_name' => 'if0_XXXXXXXX_smartcalendar',
    'db_user' => 'if0_XXXXXXXX',
    'db_password' => 'REPLACE_WITH_DATABASE_PASSWORD',

    // Generate on your own computer with:
    // node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    // Keep this value stable and private; changing it makes previously saved AI keys unreadable.
    'app_encryption_key' => 'REPLACE_WITH_64_HEX_CHARACTERS',

    // Use the full HTTPS origin for the site's root domain/subdomain, without a trailing slash.
    'site_url' => 'https://your-site.example',

    // External SMTP provider. InfinityFree free hosting does not reliably deliver PHP mail().
    // For Gmail, use smtp.gmail.com with port 587 and a NEW Google App Password.
    'smtp_host' => 'smtp.gmail.com',
    'smtp_port' => 587,
    'smtp_username' => 'your-email@gmail.com',
    'smtp_password' => 'REPLACE_WITH_NEW_SMTP_APP_PASSWORD',
    'email_from' => 'your-email@gmail.com',
    'email_from_name' => 'Smart Calendar'
];
