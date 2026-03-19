<?php

//includes
require_once dirname(__DIR__, 2)."/resources/require.php";
require_once "resources/check_auth.php";

//check permission
if (!permission_exists('webrtc_phone_view')) {
	echo json_encode(['error' => 'permission_denied']);
	exit;
}

//set content type
header('Content-Type: application/json');
header('Cache-Control: no-cache');

//get domain uuid and name
$domain_uuid = $_SESSION['domain_uuid'] ?? '';
$domain_name = $_SESSION['domain_name'] ?? '';

if (empty($domain_uuid)) {
	echo json_encode(['error' => 'not_authenticated']);
	exit;
}

//get CRM settings from session (merged default + domain settings)
$crm_url = $_SESSION['webrtc_phone']['crm_url']['text'] ?? '';
$crm_method = strtoupper($_SESSION['webrtc_phone']['crm_method']['text'] ?? 'GET');
$crm_agent_login_url = $_SESSION['webrtc_phone']['crm_agent_login_url']['text'] ?? '';
$crm_agent_logout_url = $_SESSION['webrtc_phone']['crm_agent_logout_url']['text'] ?? '';

//get event data from request
$event = $_REQUEST['event'] ?? '';
$caller_id = $_REQUEST['caller_id'] ?? '';
$caller_name = $_REQUEST['caller_name'] ?? '';
$destination = $_REQUEST['destination'] ?? '';
$direction = $_REQUEST['direction'] ?? '';
$duration = $_REQUEST['duration'] ?? '0';
$extension = $_REQUEST['extension'] ?? '';
$call_id = $_REQUEST['call_id'] ?? '';
$timestamp = $_REQUEST['timestamp'] ?? date('c');

//validate event name
$valid_events = ['new_call', 'dial_out', 'answered', 'hangup', 'ringing', 'agent_login', 'agent_logout'];
if (!in_array($event, $valid_events)) {
	echo json_encode(['error' => 'invalid_event', 'valid' => $valid_events]);
	exit;
}

//select the correct URL based on event type
if ($event === 'agent_login') {
	$crm_url = $crm_agent_login_url;
} elseif ($event === 'agent_logout') {
	$crm_url = $crm_agent_logout_url;
}

if (empty($crm_url)) {
	echo json_encode(['error' => 'crm_url_not_configured_for_' . $event]);
	exit;
}

//replace placeholders in the CRM URL
$placeholders = [
	'{event}' => $event,
	'{caller_id}' => $caller_id,
	'{caller_name}' => $caller_name,
	'{destination}' => $destination,
	'{direction}' => $direction,
	'{duration}' => $duration,
	'{extension}' => $extension,
	'{call_id}' => $call_id,
	'{timestamp}' => $timestamp,
	'{domain}' => $domain_name,
];

$url = $crm_url;
foreach ($placeholders as $key => $value) {
	$url = str_replace($key, urlencode($value), $url);
}

//make the HTTP request server-side
$ch = curl_init();

if ($crm_method === 'POST') {
	curl_setopt($ch, CURLOPT_URL, $url);
	curl_setopt($ch, CURLOPT_POST, true);
	curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
	$post_body = json_encode($placeholders);
	curl_setopt($ch, CURLOPT_POSTFIELDS, $post_body);
} else {
	curl_setopt($ch, CURLOPT_URL, $url);
}

curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 5);
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 3);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_MAXREDIRS, 3);
curl_setopt($ch, CURLOPT_USERAGENT, 'FusionPBX-WebRTC-Phone/1.0');

$response = curl_exec($ch);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curl_error = curl_error($ch);
curl_close($ch);

//return result
$result = [
	'ok' => ($http_code >= 200 && $http_code < 400),
	'http_code' => $http_code,
	'event' => $event,
];

if (!empty($curl_error)) {
	$result['ok'] = false;
	$result['error'] = $curl_error;
}

echo json_encode($result);

?>
