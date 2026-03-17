<?php

/*
	FusionPBX
	Version: MPL 1.1

	Click-to-Dial API
	Token-authenticated endpoint for third-party websites.
	Returns WSS config and extension credentials for the associated token.
*/

//allow cross-origin requests — always send CORS headers
$origin = $_SERVER['HTTP_ORIGIN'] ?? '*';
header('Access-Control-Allow-Origin: ' . $origin);
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-CTD-Token');
header('Access-Control-Allow-Credentials: false');
header('Access-Control-Max-Age: 86400');

//handle preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
	http_response_code(204);
	exit;
}

//set content type
header('Content-Type: application/json');

//includes
$document_root = dirname(__DIR__, 3);
require_once $document_root."/resources/require.php";

//get the token from header or query parameter
$token = '';
if (!empty($_SERVER['HTTP_X_CTD_TOKEN'])) {
	$token = $_SERVER['HTTP_X_CTD_TOKEN'];
} elseif (!empty($_GET['token'])) {
	$token = $_GET['token'];
}

if (empty($token) || strlen($token) < 32) {
	http_response_code(401);
	echo json_encode(['error' => 'invalid_token']);
	exit;
}

//look up the token in the database
$sql = "SELECT t.click_to_dial_token_uuid, t.domain_uuid, t.extension_uuid, ";
$sql .= "t.allowed_origins, t.token_enabled, t.button_color, t.button_position, t.button_label, t.button_shadow, t.button_orientation, ";
$sql .= "t.destination_number, t.departments, t.destinations, t.lazy_registration, t.show_dtmf, ";
$sql .= "e.extension, e.password, e.effective_caller_id_name, e.effective_caller_id_number, ";
$sql .= "d.domain_name ";
$sql .= "FROM v_click_to_dial_tokens AS t ";
$sql .= "JOIN v_extensions AS e ON t.extension_uuid = e.extension_uuid ";
$sql .= "JOIN v_domains AS d ON t.domain_uuid = d.domain_uuid ";
$sql .= "WHERE t.api_token = :token ";
$sql .= "AND t.token_enabled = 'true' ";
$sql .= "AND e.enabled = 'true' ";

$parameters['token'] = $token;

$database = new database;
$row = $database->select($sql, $parameters, 'row');
unset($sql, $parameters);

if (empty($row)) {
	http_response_code(401);
	echo json_encode(['error' => 'token_not_found']);
	exit;
}

//validate origin if allowed_origins is set
$allowed_origins = trim($row['allowed_origins'] ?? '');
if (!empty($allowed_origins) && !empty($origin)) {
	$origins_list = array_map('trim', explode("\n", $allowed_origins));
	$origin_allowed = false;
	foreach ($origins_list as $allowed) {
		if (empty($allowed)) continue;
		//support wildcard matching
		if ($allowed === '*') { $origin_allowed = true; break; }
		if (strcasecmp($origin, $allowed) === 0) { $origin_allowed = true; break; }
		//support wildcard subdomain: *.example.com
		if (strpos($allowed, '*.') === 0) {
			$suffix = substr($allowed, 1); // .example.com
			if (substr(strtolower($origin), -strlen($suffix)) === strtolower($suffix)) {
				$origin_allowed = true; break;
			}
		}
	}
	if (!$origin_allowed) {
		http_response_code(403);
		echo json_encode(['error' => 'origin_not_allowed']);
		exit;
	}
}

//get wss settings for this domain
$domain_uuid = $row['domain_uuid'];
$sql = "SELECT default_setting_value FROM v_default_settings ";
$sql .= "WHERE default_setting_category = 'webrtc_phone' ";
$sql .= "AND default_setting_subcategory = :subcategory ";
$sql .= "AND default_setting_enabled = 'true' ";

//get wss_port
$parameters = ['subcategory' => 'wss_port'];
$wss_row = $database->select($sql, $parameters, 'row');
$wss_port = $wss_row['default_setting_value'] ?? '7443';

//get stun_server
$parameters = ['subcategory' => 'stun_server'];
$stun_row = $database->select($sql, $parameters, 'row');
$stun_server = $stun_row['default_setting_value'] ?? 'stun:stun.l.google.com:19302';
unset($sql, $parameters);

//parse departments list
$departments_raw = trim($row['departments'] ?? '');
$departments_list = [];
if (!empty($departments_raw)) {
	$departments_list = array_values(array_filter(array_map('trim', explode("\n", $departments_raw))));
}

//parse destinations JSON
$destinations_raw = $row['destinations'] ?? '[]';
$destinations_parsed = json_decode($destinations_raw, true);
if (!is_array($destinations_parsed)) {
	$destinations_parsed = [];
}

//build response
$response = [
	'domain' => $row['domain_name'],
	'wss_port' => $wss_port,
	'stun_server' => $stun_server,
	'extension' => $row['extension'],
	'password' => $row['password'],
	'caller_id_name' => $row['effective_caller_id_name'] ?? $row['extension'],
	'caller_id_number' => $row['effective_caller_id_number'] ?? $row['extension'],
	'destination_number' => $row['destination_number'] ?? '',
	'destinations' => $destinations_parsed,
	'departments' => $departments_list,
	'lazy_registration' => ($row['lazy_registration'] ?? 'false') === 'true',
	'show_dtmf' => ($row['show_dtmf'] ?? 'true') === 'true',
	'ui' => [
		'button_color' => $row['button_color'] ?? '#1a73e8',
		'button_position' => $row['button_position'] ?? 'bottom-right',
		'button_label' => $row['button_label'] ?? '',
		'button_shadow' => $row['button_shadow'] ?? 'normal',
		'button_orientation' => $row['button_orientation'] ?? 'horizontal'
	]
];

echo json_encode($response);
exit;

?>
