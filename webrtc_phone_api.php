<?php

/*
	FusionPBX
	Version: MPL 1.1

	WebRTC Phone API
	Returns the current user's extensions and WSS configuration as JSON.
*/

//includes
$document_root = dirname(__DIR__, 2);
require_once $document_root."/resources/require.php";
require_once $document_root."/resources/check_auth.php";

//check permissions
if (permission_exists('webrtc_phone_view')) {
	//access granted
} else {
	echo json_encode(['error' => 'access_denied']);
	exit;
}

//set content type
header('Content-Type: application/json');

//get the domain
$domain_uuid = $_SESSION['domain_uuid'] ?? '';
$domain_name = $_SESSION['domain_name'] ?? '';
$user_uuid = $_SESSION['user_uuid'] ?? '';

if (empty($domain_uuid) || empty($user_uuid)) {
	echo json_encode(['error' => 'session_invalid']);
	exit;
}

//get wss settings from default settings
$wss_port = $_SESSION['webrtc_phone']['wss_port']['text'] ?? '7443';
$stun_server = $_SESSION['webrtc_phone']['stun_server']['text'] ?? 'stun:stun.l.google.com:19302';
$webrtc_enabled = $_SESSION['webrtc_phone']['enabled']['boolean'] ?? 'true';

if ($webrtc_enabled !== 'true') {
	echo json_encode(['error' => 'webrtc_phone_disabled']);
	exit;
}

//query extensions assigned to the current user
$sql = "SELECT e.extension_uuid, e.extension, e.password, e.effective_caller_id_name, e.effective_caller_id_number, e.outbound_caller_id_name, e.outbound_caller_id_number, e.description, e.enabled ";
$sql .= "FROM v_extensions AS e ";
$sql .= "JOIN v_extension_users AS eu ON e.extension_uuid = eu.extension_uuid ";
$sql .= "WHERE eu.user_uuid = :user_uuid ";
$sql .= "AND e.domain_uuid = :domain_uuid ";
$sql .= "AND e.enabled = 'true' ";
$sql .= "ORDER BY e.extension ASC ";

$parameters['user_uuid'] = $user_uuid;
$parameters['domain_uuid'] = $domain_uuid;

$database = new database;
$extensions = $database->select($sql, $parameters, 'all');
unset($sql, $parameters);

if (!is_array($extensions)) {
	$extensions = [];
}

//build response
$response = [
	'domain' => $domain_name,
	'wss_port' => $wss_port,
	'stun_server' => $stun_server,
	'extensions' => []
];

foreach ($extensions as $ext) {
	$response['extensions'][] = [
		'extension_uuid' => $ext['extension_uuid'],
		'extension' => $ext['extension'],
		'password' => $ext['password'],
		'caller_id_name' => $ext['effective_caller_id_name'] ?? $ext['extension'],
		'caller_id_number' => $ext['effective_caller_id_number'] ?? $ext['extension'],
		'description' => $ext['description'] ?? ''
	];
}

echo json_encode($response);
exit;

?>
