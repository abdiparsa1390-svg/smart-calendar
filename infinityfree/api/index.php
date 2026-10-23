<?php
declare(strict_types=1);

/* Smart Calendar PHP API for InfinityFree. Secrets belong in config.php, never in the repository. */
error_reporting(E_ALL);
ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, private');
header('X-Content-Type-Options: nosniff');

function respond(int $status, array $payload): never {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}
final class ApiException extends RuntimeException {
    public int $statusCode;
    public function __construct(int $statusCode, string $message) {
        parent::__construct($message);
        $this->statusCode = $statusCode;
    }
}
function apiFail(int $statusCode, string $message): never {
    throw new ApiException($statusCode, $message);
}

$configFile = __DIR__ . '/config.php';
if (!is_file($configFile)) {
    respond(503, ['error' => 'The API is not configured yet. Copy config.example.php to config.php and enter your database, encryption key, site URL, and SMTP settings.']);
}
$config = require $configFile;
if (!is_array($config)) {
    respond(503, ['error' => 'The API configuration file is invalid.']);
}
try {
    foreach (['db_host', 'db_name', 'db_user', 'db_password', 'app_encryption_key', 'site_url'] as $key) {
        if (!isset($config[$key]) || !is_string($config[$key]) || trim($config[$key]) === '') {
            throw new RuntimeException('Missing required configuration: ' . $key);
        }
    }
    if (!preg_match('/^[a-f0-9]{64}$/i', (string)$config['app_encryption_key'])) {
        throw new RuntimeException('The encryption key must be exactly 64 hexadecimal characters.');
    }
    $siteParts = parse_url((string)$config['site_url']);
    if (!$siteParts || empty($siteParts['scheme']) || empty($siteParts['host']) || !in_array(strtolower($siteParts['scheme']), ['https', 'http'], true)) {
        throw new RuntimeException('The public site URL is invalid.');
    }
} catch (Throwable $e) {
    error_log('Smart Calendar configuration error: ' . $e->getMessage());
    respond(503, ['error' => 'The API configuration is incomplete. Review api/config.php and try again.']);
}

$isHttps = (!empty($_SERVER['HTTPS']) && strtolower((string)$_SERVER['HTTPS']) !== 'off')
    || strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
session_name('smart_calendar_session');
session_set_cookie_params([
    'lifetime' => 604800,
    'path' => '/',
    'secure' => $isHttps,
    'httponly' => true,
    'samesite' => 'Lax'
]);
ini_set('session.use_strict_mode', '1');
ini_set('session.use_only_cookies', '1');

try {
    $dsn = 'mysql:host=' . (string)$config['db_host'] . ';port=' . (int)($config['db_port'] ?? 3306)
        . ';dbname=' . (string)$config['db_name'] . ';charset=utf8mb4';
    $pdo = new PDO($dsn, (string)$config['db_user'], (string)$config['db_password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
        PDO::ATTR_TIMEOUT => 8
    ]);
    $pdo->exec("SET time_zone = '+00:00'");
} catch (Throwable $e) {
    error_log('Smart Calendar database connection failed: ' . $e->getMessage());
    respond(503, ['error' => 'Could not connect to MySQL. Check the database host, name, username, password, and that schema.sql was imported.']);
}
try {
    session_start();
} catch (Throwable $e) {
    error_log('Smart Calendar session error: ' . $e->getMessage());
    respond(500, ['error' => 'Could not start a secure session.']);
}

function normaliseEmail(mixed $value): string {
    return strtolower(trim((string)$value));
}
function validEmail(string $email): bool {
    return strlen($email) <= 254 && filter_var($email, FILTER_VALIDATE_EMAIL) !== false;
}
function uuidV4(): string {
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
    $hex = bin2hex($bytes);
    return substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-' . substr($hex, 12, 4) . '-' . substr($hex, 16, 4) . '-' . substr($hex, 20);
}
function randomToken(): string {
    return bin2hex(random_bytes(32));
}
function sha256(string $value): string {
    return hash('sha256', $value);
}
function publicUser(array $row): array {
    return [
        'id' => (string)$row['id'],
        'email' => (string)$row['email'],
        'emailVerifiedAt' => $row['email_verified_at'] ?? null
    ];
}
function sameSiteOriginAllowed(array $config): bool {
    $origin = trim((string)($_SERVER['HTTP_ORIGIN'] ?? ''));
    if ($origin === '') {
        return true;
    }
    $originParts = parse_url($origin);
    $siteParts = parse_url((string)$config['site_url']);
    if (!$originParts || !$siteParts || empty($originParts['host']) || empty($siteParts['host'])) {
        return false;
    }
    return strtolower((string)$originParts['host']) === strtolower((string)$siteParts['host'])
        && strtolower((string)($originParts['scheme'] ?? '')) === strtolower((string)($siteParts['scheme'] ?? ''));
}
function rateLimit(PDO $pdo, array $config, string $scope, int $limit, int $windowSeconds): void {
    $ip = (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $ipHash = hash('sha256', $ip . '|' . (string)$config['app_encryption_key']);
    $cutoff = gmdate('Y-m-d H:i:s', time() - $windowSeconds);
    $stmt = $pdo->prepare(
        'INSERT INTO request_limits (scope, ip_hash, window_start, hits) VALUES (?, ?, UTC_TIMESTAMP(), 1)
         ON DUPLICATE KEY UPDATE
           hits = IF(window_start < ?, 1, hits + 1),
           window_start = IF(window_start < ?, UTC_TIMESTAMP(), window_start)'
    );
    $stmt->execute([$scope, $ipHash, $cutoff, $cutoff]);
    $check = $pdo->prepare('SELECT window_start, hits FROM request_limits WHERE scope = ? AND ip_hash = ? LIMIT 1');
    $check->execute([$scope, $ipHash]);
    $state = $check->fetch();
    if ($state && (int)$state['hits'] > $limit) {
        $retry = max(1, (int)(strtotime((string)$state['window_start'] . ' UTC') + $windowSeconds - time()));
        header('Retry-After: ' . $retry);
        respond(429, ['error' => 'Too many requests. Please wait a little and try again.']);
    }
}
function requireUser(PDO $pdo): array {
    $userId = (string)($_SESSION['user_id'] ?? '');
    $expiresAt = (int)($_SESSION['expires_at'] ?? 0);
    if ($userId === '' || $expiresAt < time()) {
        $_SESSION = [];
        session_regenerate_id(true);
        respond(401, ['error' => 'Please sign in to continue.']);
    }
    $stmt = $pdo->prepare('SELECT id, email, email_verified_at FROM users WHERE id = ? LIMIT 1');
    $stmt->execute([$userId]);
    $user = $stmt->fetch();
    if (!$user || empty($user['email_verified_at'])) {
        $_SESSION = [];
        session_regenerate_id(true);
        respond(401, ['error' => 'Please sign in to continue.']);
    }
    return $user;
}
function sendVerificationEmail(array $config, string $email, string $token): void {
    foreach (['smtp_host', 'smtp_username', 'smtp_password', 'email_from'] as $key) {
        if (trim((string)($config[$key] ?? '')) === '') {
            throw new RuntimeException('SMTP settings are incomplete.');
        }
    }
    $link = rtrim((string)$config['site_url'], '/') . '/?verify=' . rawurlencode($token);
    $safeLink = htmlspecialchars($link, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $mail = new PHPMailer\PHPMailer\PHPMailer(true);
    $mail->isSMTP();
    $mail->Host = (string)$config['smtp_host'];
    $mail->SMTPAuth = true;
    $mail->Username = (string)$config['smtp_username'];
    $mail->Password = preg_replace('/\s+/', '', (string)$config['smtp_password']);
    $mail->Port = (int)($config['smtp_port'] ?? 587);
    $mail->SMTPSecure = PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS;
    $mail->Timeout = 15;
    $mail->CharSet = 'UTF-8';
    $mail->setFrom((string)$config['email_from'], (string)($config['email_from_name'] ?? 'Smart Calendar'));
    $mail->addAddress($email);
    $mail->isHTML(true);
    $mail->Subject = 'Verify your Smart Calendar account';
    $mail->Body = '<div style="font-family:Arial,sans-serif;max-width:520px;margin:32px auto;padding:28px;border:1px solid #e8e8f2;border-radius:16px;color:#303147"><h1 style="font-size:23px">Welcome to Smart Calendar</h1><p>Confirm your email address to activate your account.</p><p style="margin:28px 0"><a href="' . $safeLink . '" style="background:#686acf;color:#fff;padding:12px 18px;border-radius:9px;text-decoration:none;font-weight:700">Verify email</a></p><p style="font-size:12px;color:#85869b">This link expires in 30 minutes. If you did not create an account, ignore this message.</p></div>';
    $mail->AltBody = "Welcome to Smart Calendar.\n\nVerify your email address by opening this link:\n" . $link . "\n\nThis link expires in 30 minutes.";
    $mail->send();
}
function encryptionKey(array $config): string {
    $key = hex2bin((string)$config['app_encryption_key']);
    if ($key === false || strlen($key) !== 32) {
        throw new RuntimeException('The encryption key is invalid.');
    }
    return $key;
}
function encryptApiKey(array $config, string $value): array {
    $iv = random_bytes(12);
    $tag = '';
    $ciphertext = openssl_encrypt($value, 'aes-256-gcm', encryptionKey($config), OPENSSL_RAW_DATA, $iv, $tag);
    if ($ciphertext === false || strlen($tag) !== 16) {
        throw new RuntimeException('Could not encrypt the AI key.');
    }
    return ['ciphertext' => base64_encode($ciphertext), 'iv' => base64_encode($iv), 'tag' => base64_encode($tag)];
}
function decryptApiKey(array $config, array $row): string {
    $ciphertext = base64_decode((string)$row['api_key_ciphertext'], true);
    $iv = base64_decode((string)$row['api_key_iv'], true);
    $tag = base64_decode((string)$row['api_key_tag'], true);
    if ($ciphertext === false || $iv === false || $tag === false) {
        throw new RuntimeException('Saved AI credentials could not be read.');
    }
    $plain = openssl_decrypt($ciphertext, 'aes-256-gcm', encryptionKey($config), OPENSSL_RAW_DATA, $iv, $tag);
    if ($plain === false) {
        throw new RuntimeException('Saved AI credentials could not be decrypted.');
    }
    return $plain;
}
function validateAIBaseUrl(mixed $input): string {
    $value = trim((string)$input);
    $parts = parse_url($value);
    if (!$parts || strtolower((string)($parts['scheme'] ?? '')) !== 'https' || empty($parts['host'])) {
        apiFail(400, 'Enter a valid HTTPS AI provider Base URL.');
    }
    if (isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment'])) {
        apiFail(400, 'The Base URL must not contain credentials, query parameters, or fragments.');
    }
    $host = strtolower(rtrim((string)$parts['host'], '.'));
    if ($host === 'localhost' || str_ends_with($host, '.localhost') || str_ends_with($host, '.local') || $host === 'metadata.google.internal') {
        apiFail(400, 'Private or local network addresses are not allowed.');
    }
    if (filter_var($host, FILTER_VALIDATE_IP) !== false) {
        if (filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
            apiFail(400, 'Private or local network addresses are not allowed.');
        }
    } else {
        $addresses = @gethostbynamel($host);
        if (is_array($addresses)) {
            foreach ($addresses as $address) {
                if (filter_var($address, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
                    apiFail(400, 'Private or local network addresses are not allowed.');
                }
            }
        }
    }
    return rtrim($value, '/');
}
function getAISettings(PDO $pdo, string $userId): ?array {
    $stmt = $pdo->prepare('SELECT base_url, model, api_key_ciphertext, api_key_iv, api_key_tag FROM ai_settings WHERE user_id = ? LIMIT 1');
    $stmt->execute([$userId]);
    $row = $stmt->fetch();
    return $row ?: null;
}
function resolveAIConfig(PDO $pdo, array $config, string $userId, array $overrides = [], bool $allowUnsavedKey = false): array {
    $saved = getAISettings($pdo, $userId);
    $baseUrl = trim((string)($overrides['baseUrl'] ?? $saved['base_url'] ?? ''));
    $model = trim((string)($overrides['model'] ?? $saved['model'] ?? ''));
    $apiKey = '';
    if ($allowUnsavedKey && trim((string)($overrides['apiKey'] ?? '')) !== '') {
        $apiKey = trim((string)$overrides['apiKey']);
    } elseif ($saved && !empty($saved['api_key_ciphertext'])) {
        $apiKey = decryptApiKey($config, $saved);
    }
    if ($baseUrl === '' || $model === '' || $apiKey === '') {
        apiFail(400, 'Set your Base URL, model, and API key in AI settings first.');
    }
    if (strlen($model) > 200 || strlen($apiKey) > 4096) {
        apiFail(400, 'The model name or API key is too long.');
    }
    return ['baseUrl' => validateAIBaseUrl($baseUrl), 'model' => $model, 'apiKey' => $apiKey];
}
function askAI(array $aiConfig, array $messages): array {
    if (!function_exists('curl_init')) {
        apiFail(502, 'The server HTTP client is unavailable. Contact the site owner.');
    }
    $base = $aiConfig['baseUrl'];
    $endpoint = preg_match('~/chat/completions$~i', $base) ? $base : $base . '/chat/completions';
    $payload = json_encode(['model' => $aiConfig['model'], 'messages' => $messages, 'temperature' => 0.7], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    $curl = curl_init($endpoint);
    curl_setopt_array($curl, [
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . $aiConfig['apiKey']],
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 35,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_MAXREDIRS => 0
    ]);
    $raw = curl_exec($curl);
    $curlError = curl_error($curl);
    $status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    curl_close($curl);
    if ($raw === false) {
        error_log('Smart Calendar AI network request failed: ' . $curlError);
        apiFail(502, 'Could not reach the AI provider. Check the Base URL and try again.');
    }
    $data = json_decode((string)$raw, true);
    if ($status < 200 || $status >= 300) {
        $message = is_array($data) ? (string)($data['error']['message'] ?? $data['message'] ?? '') : '';
        if ($message === '') {
            $message = 'AI provider returned HTTP ' . $status . '.';
        }
        apiFail(502, mb_substr($message, 0, 500));
    }
    if (!is_array($data)) {
        apiFail(502, 'The AI provider returned an invalid response.');
    }
    return $data;
}
function parseUtcDate(mixed $value): ?DateTimeImmutable {
    if (!is_string($value) || trim($value) === '') {
        return null;
    }
    try {
        return (new DateTimeImmutable($value))->setTimezone(new DateTimeZone('UTC'));
    } catch (Throwable) {
        return null;
    }
}
function eventPublicRow(array $row): array {
    return [
        'id' => (string)$row['id'],
        'title' => (string)$row['title'],
        'start' => gmdate('Y-m-d\TH:i:s\Z', strtotime((string)$row['start_at'] . ' UTC')),
        'end' => gmdate('Y-m-d\TH:i:s\Z', strtotime((string)$row['end_at'] . ' UTC')),
        'color' => (string)$row['color'],
        'place' => (string)$row['place'],
        'source' => 'local'
    ];
}

$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$uri = (string)($_SERVER['REQUEST_URI'] ?? '/api/health');
$path = (string)(parse_url($uri, PHP_URL_PATH) ?: '/api/health');
$path = preg_replace('#^/api(?:/index\.php)?#', '', $path) ?? '';
$path = '/' . trim($path, '/');
if ($path === '//') {
    $path = '/';
}
if (in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true) && !sameSiteOriginAllowed($config)) {
    respond(403, ['error' => 'Request origin is not allowed.']);
}
$body = [];
if (in_array($method, ['POST', 'PUT', 'PATCH'], true)) {
    $rawBody = file_get_contents('php://input', false, null, 0, 1048577);
    if ($rawBody === false || strlen($rawBody) > 1048576) {
        respond(413, ['error' => 'Request body is too large.']);
    }
    if (trim($rawBody) !== '') {
        $decoded = json_decode($rawBody, true);
        if (!is_array($decoded)) {
            respond(400, ['error' => 'Send a valid JSON request body.']);
        }
        $body = $decoded;
    }
}

try {
    if ($method === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
    if ($method === 'GET' && $path === '/health') {
        respond(200, ['ok' => true, 'service' => 'smart-calendar-php-api']);
    }
    if ($method === 'POST' && $path === '/auth/register') {
        rateLimit($pdo, $config, 'auth', 30, 900);
        $email = normaliseEmail($body['email'] ?? '');
        $password = (string)($body['password'] ?? '');
        if (!validEmail($email)) {
            respond(400, ['error' => 'Enter a valid email address.']);
        }
        if (strlen($password) < 10 || strlen($password) > 200) {
            respond(400, ['error' => 'Use a password between 10 and 200 characters.']);
        }
        $id = uuidV4();
        $token = randomToken();
        try {
            $stmt = $pdo->prepare('INSERT INTO users (id, email, password_hash, verification_token_hash, verification_expires_at) VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 MINUTE))');
            $stmt->execute([$id, $email, password_hash($password, PASSWORD_DEFAULT), sha256($token)]);
        } catch (PDOException $e) {
            if ((string)$e->getCode() === '23000') {
                respond(409, ['error' => 'An account with this email already exists. Try signing in instead.']);
            }
            throw $e;
        }
        try {
            sendVerificationEmail($config, $email, $token);
        } catch (Throwable $mailError) {
            $delete = $pdo->prepare('DELETE FROM users WHERE id = ? AND email_verified_at IS NULL');
            $delete->execute([$id]);
            error_log('Smart Calendar verification email failed: ' . $mailError->getMessage());
            respond(503, ['error' => 'We could not send your verification email. Check the SMTP settings in api/config.php and try again.']);
        }
        respond(201, ['message' => 'Check your inbox for a verification link. The link expires in 30 minutes.']);
    }
    if ($method === 'POST' && $path === '/auth/verify-email') {
        rateLimit($pdo, $config, 'auth', 30, 900);
        $token = (string)($body['token'] ?? '');
        if (strlen($token) < 20 || strlen($token) > 300) {
            respond(400, ['error' => 'This verification link is invalid or expired.']);
        }
        $stmt = $pdo->prepare('UPDATE users SET email_verified_at = UTC_TIMESTAMP(), verification_token_hash = NULL, verification_expires_at = NULL WHERE verification_token_hash = ? AND verification_expires_at > UTC_TIMESTAMP() AND email_verified_at IS NULL');
        $stmt->execute([sha256($token)]);
        if ($stmt->rowCount() !== 1) {
            respond(400, ['error' => 'This verification link is invalid or expired. Request a new verification email.']);
        }
        respond(200, ['message' => 'Email verified. You can now sign in.']);
    }
    if ($method === 'POST' && $path === '/auth/resend-verification') {
        rateLimit($pdo, $config, 'auth', 30, 900);
        $email = normaliseEmail($body['email'] ?? '');
        if (!validEmail($email)) {
            respond(400, ['error' => 'Enter a valid email address.']);
        }
        $stmt = $pdo->prepare('SELECT id, email_verified_at FROM users WHERE email = ? LIMIT 1');
        $stmt->execute([$email]);
        $user = $stmt->fetch();
        if (!$user || !empty($user['email_verified_at'])) {
            respond(200, ['message' => 'If the account needs verification, an email will be sent.']);
        }
        $token = randomToken();
        $update = $pdo->prepare('UPDATE users SET verification_token_hash = ?, verification_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 MINUTE) WHERE id = ?');
        $update->execute([sha256($token), $user['id']]);
        try {
            sendVerificationEmail($config, $email, $token);
        } catch (Throwable $mailError) {
            error_log('Smart Calendar resend email failed: ' . $mailError->getMessage());
            respond(503, ['error' => 'We could not send the verification email. Check the SMTP settings and try again.']);
        }
        respond(200, ['message' => 'If the account needs verification, an email will be sent.']);
    }
    if ($method === 'POST' && $path === '/auth/login') {
        rateLimit($pdo, $config, 'auth', 30, 900);
        $email = normaliseEmail($body['email'] ?? '');
        $password = (string)($body['password'] ?? '');
        if (!validEmail($email) || $password === '') {
            respond(400, ['error' => 'Enter your email and password.']);
        }
        $stmt = $pdo->prepare('SELECT id, email, password_hash, email_verified_at FROM users WHERE email = ? LIMIT 1');
        $stmt->execute([$email]);
        $user = $stmt->fetch();
        if (!$user || !password_verify($password, (string)$user['password_hash'])) {
            respond(401, ['error' => 'Email or password is incorrect.']);
        }
        if (empty($user['email_verified_at'])) {
            respond(403, ['error' => 'Verify your email before signing in. You can request a new verification email.']);
        }
        session_regenerate_id(true);
        $_SESSION = ['user_id' => (string)$user['id'], 'expires_at' => time() + 604800];
        respond(200, ['user' => publicUser($user)]);
    }
    if ($method === 'GET' && $path === '/auth/me') {
        respond(200, ['user' => publicUser(requireUser($pdo))]);
    }
    if ($method === 'POST' && $path === '/auth/logout') {
        requireUser($pdo);
        $_SESSION = [];
        setcookie(session_name(), '', [
            'expires' => time() - 42000,
            'path' => '/',
            'secure' => $isHttps,
            'httponly' => true,
            'samesite' => 'Lax'
        ]);
        session_destroy();
        respond(200, ['message' => 'Signed out.']);
    }
    if ($method === 'GET' && $path === '/events') {
        $user = requireUser($pdo);
        $stmt = $pdo->prepare('SELECT id, title, start_at, end_at, color, place FROM user_events WHERE user_id = ? ORDER BY start_at ASC');
        $stmt->execute([$user['id']]);
        respond(200, ['events' => array_map('eventPublicRow', $stmt->fetchAll())]);
    }
    if ($method === 'PUT' && $path === '/events') {
        $user = requireUser($pdo);
        $events = $body['events'] ?? null;
        if (!is_array($events) || count($events) > 1000) {
            respond(400, ['error' => 'Events must be an array of no more than 1,000 items.']);
        }
        $normalised = [];
        foreach ($events as $event) {
            if (!is_array($event)) {
                respond(400, ['error' => 'One or more events have invalid fields or times.']);
            }
            $id = trim((string)($event['id'] ?? ''));
            $title = mb_substr(trim((string)($event['title'] ?? '')), 0, 240);
            $start = parseUtcDate($event['start'] ?? null);
            $end = parseUtcDate($event['end'] ?? null);
            if ($id === '' || strlen($id) > 100 || $title === '' || !$start || !$end || $end <= $start) {
                respond(400, ['error' => 'One or more events have invalid fields or times.']);
            }
            $color = (string)($event['color'] ?? '');
            if (!preg_match('/^#[0-9a-f]{6}$/i', $color)) {
                $color = '#6d72d9';
            }
            $normalised[] = [
                'id' => $id,
                'title' => $title,
                'start' => $start->format('Y-m-d H:i:s'),
                'end' => $end->format('Y-m-d H:i:s'),
                'color' => $color,
                'place' => mb_substr((string)($event['place'] ?? ''), 0, 2000)
            ];
        }
        $pdo->beginTransaction();
        try {
            $delete = $pdo->prepare('DELETE FROM user_events WHERE user_id = ?');
            $delete->execute([$user['id']]);
            $insert = $pdo->prepare('INSERT INTO user_events (id, user_id, title, start_at, end_at, color, place) VALUES (?, ?, ?, ?, ?, ?, ?)');
            foreach ($normalised as $event) {
                $insert->execute([$event['id'], $user['id'], $event['title'], $event['start'], $event['end'], $event['color'], $event['place']]);
            }
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
        respond(200, ['saved' => count($normalised)]);
    }
    if ($method === 'GET' && $path === '/ai/settings') {
        $user = requireUser($pdo);
        $row = getAISettings($pdo, (string)$user['id']);
        respond(200, [
            'baseUrl' => $row['base_url'] ?? 'https://api.openai.com/v1',
            'model' => $row['model'] ?? '',
            'apiKeyConfigured' => (bool)($row['api_key_ciphertext'] ?? false)
        ]);
    }
    if ($method === 'PUT' && $path === '/ai/settings') {
        $user = requireUser($pdo);
        $baseUrl = validateAIBaseUrl($body['baseUrl'] ?? '');
        $model = trim((string)($body['model'] ?? ''));
        $apiKey = trim((string)($body['apiKey'] ?? ''));
        if ($model === '' || strlen($model) > 200) {
            respond(400, ['error' => 'Enter a valid model name.']);
        }
        if (strlen($apiKey) > 4096) {
            respond(400, ['error' => 'The API key is too long.']);
        }
        $existing = getAISettings($pdo, (string)$user['id']);
        if ($apiKey !== '') {
            $encrypted = encryptApiKey($config, $apiKey);
        } elseif ($existing && !empty($existing['api_key_ciphertext'])) {
            $encrypted = [
                'ciphertext' => $existing['api_key_ciphertext'],
                'iv' => $existing['api_key_iv'],
                'tag' => $existing['api_key_tag']
            ];
        } else {
            respond(400, ['error' => 'Enter your API key before saving settings.']);
        }
        $stmt = $pdo->prepare(
            'INSERT INTO ai_settings (user_id, base_url, model, api_key_ciphertext, api_key_iv, api_key_tag)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE base_url = VALUES(base_url), model = VALUES(model),
               api_key_ciphertext = VALUES(api_key_ciphertext), api_key_iv = VALUES(api_key_iv), api_key_tag = VALUES(api_key_tag), updated_at = UTC_TIMESTAMP()'
        );
        $stmt->execute([(string)$user['id'], $baseUrl, $model, $encrypted['ciphertext'], $encrypted['iv'], $encrypted['tag']]);
        respond(200, ['baseUrl' => $baseUrl, 'model' => $model, 'apiKeyConfigured' => true, 'message' => 'AI settings saved to your account.']);
    }
    if ($method === 'POST' && $path === '/ai/test') {
        rateLimit($pdo, $config, 'ai', 30, 60);
        $user = requireUser($pdo);
        $aiConfig = resolveAIConfig($pdo, $config, (string)$user['id'], $body, true);
        $data = askAI($aiConfig, [['role' => 'user', 'content' => 'Reply with only: Connected']]);
        $reply = $data['choices'][0]['message']['content'] ?? null;
        if (!$reply) {
            respond(502, ['error' => 'The AI provider returned no assistant message.']);
        }
        respond(200, ['ok' => true, 'message' => 'Connection successful. Your model replied to the test request.']);
    }
    if ($method === 'POST' && $path === '/ai/chat') {
        rateLimit($pdo, $config, 'ai', 30, 60);
        $user = requireUser($pdo);
        $messages = $body['messages'] ?? null;
        if (!is_array($messages) || count($messages) < 1 || count($messages) > 60) {
            respond(400, ['error' => 'Send between 1 and 60 chat messages.']);
        }
        $safeMessages = [];
        foreach ($messages as $message) {
            if (!is_array($message) || !in_array($message['role'] ?? '', ['system', 'user', 'assistant'], true) || !is_string($message['content'] ?? null) || mb_strlen($message['content']) > 20000) {
                respond(400, ['error' => 'One or more chat messages are invalid.']);
            }
            $safeMessages[] = ['role' => $message['role'], 'content' => $message['content']];
        }
        $aiConfig = resolveAIConfig($pdo, $config, (string)$user['id']);
        $data = askAI($aiConfig, $safeMessages);
        $answer = $data['choices'][0]['message']['content'] ?? null;
        if ($answer === null || $answer === '') {
            respond(502, ['error' => 'The AI provider returned no assistant message.']);
        }
        respond(200, ['content' => is_string($answer) ? $answer : json_encode($answer, JSON_UNESCAPED_UNICODE)]);
    }
    respond(404, ['error' => 'API endpoint not found.']);
} catch (ApiException $e) {
    respond($e->statusCode, ['error' => $e->getMessage()]);
} catch (Throwable $e) {
    error_log('Smart Calendar API error: ' . $e->getMessage());
    respond(500, ['error' => 'The server could not complete this request. Check the server configuration and database schema.']);
}
