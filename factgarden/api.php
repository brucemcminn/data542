<?php
// Fact Garden API. One file, PHP 8.1+, MySQL via PDO.
// Settings live outside the public folder in /home/<user>/factgarden/config.php.
// Tables are created on first request.

declare(strict_types=1);

const MAX_STATE_BYTES = 65536;
const KID_MAX_FAILS = 8;
const PARENT_MAX_FAILS = 5;
const LOCK_MINUTES = 15;

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

$configPath = getenv('FG_CONFIG') ?: dirname(__DIR__, 2) . '/factgarden/config.php';
if (!is_file($configPath)) {
    fail(500, 'Server is missing its config file.');
}
$cfg = require $configPath;

session_name('fgsess');
session_set_cookie_params([
    'lifetime' => 60 * 60 * 24 * 60,
    'path' => '/',
    'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
    'httponly' => true,
    'samesite' => 'Strict',
]);
ini_set('session.gc_maxlifetime', (string)(60 * 60 * 24 * 60));
session_start();

try {
    $db = new PDO($cfg['dsn'], $cfg['db_user'], $cfg['db_pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
} catch (Throwable $e) {
    $m = $e->getMessage();
    error_log('factgarden db connect: ' . $m);
    if (stripos($m, 'could not find driver') !== false) fail(500, 'Could not reach the database: PHP on this server is missing its MySQL driver (pdo_mysql).');
    if (stripos($m, 'Access denied') !== false)        fail(500, 'Could not reach the database: the db_user or db_pass in config.php is not right.');
    if (stripos($m, 'Unknown database') !== false)     fail(500, 'Could not reach the database: the database name in the dsn line of config.php is not right.');
    if ((int)$e->getCode() === 2002)                   fail(500, 'Could not reach the database: MySQL is not answering at the host in the dsn line of config.php.');
    fail(500, 'Could not reach the database. Code ' . $e->getCode() . '.');
}

$db->exec("CREATE TABLE IF NOT EXISTS fg_kids (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(40) NOT NULL UNIQUE,
    pin_hash VARCHAR(255) NOT NULL,
    state MEDIUMTEXT NULL,
    fail_count INT NOT NULL DEFAULT 0,
    locked_until DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci");
$db->exec("CREATE TABLE IF NOT EXISTS fg_meta (
    k VARCHAR(40) PRIMARY KEY,
    v VARCHAR(255) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = $_GET['a'] ?? '';
$in = [];
if ($method === 'POST') {
    $raw = file_get_contents('php://input', false, null, 0, MAX_STATE_BYTES + 4096);
    $in = json_decode($raw ?: '{}', true);
    if (!is_array($in)) fail(400, 'Bad request.');
    // Same-origin check on top of the SameSite cookie.
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $oh = parse_url($origin, PHP_URL_HOST) . (parse_url($origin, PHP_URL_PORT) ? ':' . parse_url($origin, PHP_URL_PORT) : '');
    if ($origin !== '' && strcasecmp($oh, $_SERVER['HTTP_HOST'] ?? '') !== 0) {
        fail(403, 'Wrong origin.');
    }
}

switch ("$method $action") {

    // ---------- kid ----------
    case 'GET me':
        $kid = currentKid($db);
        ok(['kid' => $kid ? ['id' => (int)$kid['id'], 'name' => $kid['name']] : null,
            'state' => $kid && $kid['state'] ? json_decode($kid['state'], true) : null]);

    case 'POST login':
        $name = cleanName($in['name'] ?? '');
        $pin = (string)($in['pin'] ?? '');
        $st = $db->prepare('SELECT * FROM fg_kids WHERE name = ?');
        $st->execute([$name]);
        $kid = $st->fetch();
        if (!$kid) { usleep(300000); fail(401, 'Name or PIN is not right.'); }
        if ($kid['locked_until'] && strtotime($kid['locked_until']) > time()) {
            fail(429, 'Too many tries. Ask a grown-up, or wait 15 minutes.');
        }
        if (!password_verify($pin, $kid['pin_hash'])) {
            $fails = (int)$kid['fail_count'] + 1;
            $lock = $fails >= KID_MAX_FAILS ? date('Y-m-d H:i:s', time() + LOCK_MINUTES * 60) : null;
            $db->prepare('UPDATE fg_kids SET fail_count = ?, locked_until = ? WHERE id = ?')
               ->execute([$lock ? 0 : $fails, $lock, $kid['id']]);
            usleep(300000);
            fail(401, 'Name or PIN is not right.');
        }
        $db->prepare('UPDATE fg_kids SET fail_count = 0, locked_until = NULL WHERE id = ?')->execute([$kid['id']]);
        session_regenerate_id(true);
        $_SESSION['kid'] = (int)$kid['id'];
        ok(['kid' => ['id' => (int)$kid['id'], 'name' => $kid['name']],
            'state' => $kid['state'] ? json_decode($kid['state'], true) : null]);

    case 'POST logout':
        unset($_SESSION['kid']);
        ok([]);

    case 'POST save':
        $kid = currentKid($db) ?? fail(401, 'Not signed in.');
        $state = $in['state'] ?? null;
        if (!is_array($state)) fail(400, 'Missing progress.');
        $json = json_encode($state);
        if (strlen($json) > MAX_STATE_BYTES) fail(413, 'Progress is too large.');
        $db->prepare('UPDATE fg_kids SET state = ?, updated_at = NOW() WHERE id = ?')->execute([$json, $kid['id']]);
        ok(['saved' => true]);

    // ---------- parent ----------
    case 'GET parent':
        ok(['parent' => !empty($_SESSION['parent'])]);

    case 'POST parent_login':
        $lock = meta($db, 'parent_lock');
        if ($lock && (int)$lock > time()) fail(429, 'Too many tries. Wait 15 minutes.');
        if (!hash_equals((string)$cfg['parent_pass'], (string)($in['pass'] ?? ''))) {
            $fails = (int)meta($db, 'parent_fails') + 1;
            if ($fails >= PARENT_MAX_FAILS) { setMeta($db, 'parent_lock', (string)(time() + LOCK_MINUTES * 60)); $fails = 0; }
            setMeta($db, 'parent_fails', (string)$fails);
            usleep(500000);
            fail(401, 'That password is not right.');
        }
        setMeta($db, 'parent_fails', '0');
        session_regenerate_id(true);
        $_SESSION['parent'] = true;
        ok(['parent' => true]);

    case 'POST parent_logout':
        unset($_SESSION['parent']);
        ok([]);

    case 'GET kids':
        needParent();
        $rows = $db->query('SELECT id, name, state, updated_at FROM fg_kids ORDER BY name')->fetchAll();
        foreach ($rows as &$r) { $r['id'] = (int)$r['id']; $r['state'] = $r['state'] ? json_decode($r['state'], true) : null; }
        ok(['kids' => $rows]);

    case 'POST add_kid':
        needParent();
        $name = cleanName($in['name'] ?? '');
        $pin = checkPin($in['pin'] ?? '');
        if ($name === '') fail(400, 'Enter a name.');
        try {
            $db->prepare('INSERT INTO fg_kids (name, pin_hash) VALUES (?, ?)')->execute([$name, password_hash($pin, PASSWORD_DEFAULT)]);
        } catch (PDOException $e) {
            fail(409, 'That name is already used.');
        }
        ok(['id' => (int)$db->lastInsertId()]);

    case 'POST set_pin':
        needParent();
        $pin = checkPin($in['pin'] ?? '');
        $db->prepare('UPDATE fg_kids SET pin_hash = ?, fail_count = 0, locked_until = NULL WHERE id = ?')
           ->execute([password_hash($pin, PASSWORD_DEFAULT), (int)($in['id'] ?? 0)]);
        ok([]);

    case 'POST reset_progress':
        needParent();
        $db->prepare('UPDATE fg_kids SET state = NULL, updated_at = NOW() WHERE id = ?')->execute([(int)($in['id'] ?? 0)]);
        ok([]);

    case 'POST delete_kid':
        needParent();
        $db->prepare('DELETE FROM fg_kids WHERE id = ?')->execute([(int)($in['id'] ?? 0)]);
        ok([]);

    default:
        fail(404, 'Unknown request.');
}

// ---------- helpers ----------
function ok(array $data): never { echo json_encode(['ok' => true] + $data); exit; }
function fail(int $code, string $msg): never { http_response_code($code); echo json_encode(['ok' => false, 'error' => $msg]); exit; }
function needParent(): void { if (empty($_SESSION['parent'])) fail(401, 'Grown-up sign-in needed.'); }
function cleanName(mixed $n): string { return mb_substr(trim(preg_replace('/\s+/u', ' ', (string)$n)), 0, 40); }
function checkPin(mixed $p): string {
    $p = (string)$p;
    if (!preg_match('/^\d{4}$/', $p)) fail(400, 'PIN must be 4 digits.');
    return $p;
}
function currentKid(PDO $db): ?array {
    if (empty($_SESSION['kid'])) return null;
    $st = $db->prepare('SELECT * FROM fg_kids WHERE id = ?');
    $st->execute([$_SESSION['kid']]);
    $k = $st->fetch();
    if (!$k) { unset($_SESSION['kid']); return null; }
    return $k;
}
function meta(PDO $db, string $k): ?string {
    $st = $db->prepare('SELECT v FROM fg_meta WHERE k = ?');
    $st->execute([$k]);
    $v = $st->fetchColumn();
    return $v === false ? null : $v;
}
function setMeta(PDO $db, string $k, string $v): void {
    $db->prepare('INSERT INTO fg_meta (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)')->execute([$k, $v]);
}
