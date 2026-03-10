<?php

/*
	FusionPBX
	Version: MPL 1.1

	WebRTC Phone - Network Report Email API
	Receives network test report data and sends it via email.
*/

//includes
$document_root = dirname(__DIR__, 2);
require_once $document_root."/resources/require.php";
require_once $document_root."/resources/check_auth.php";

//check permissions
if (!permission_exists('webrtc_phone_view')) {
	header('Content-Type: application/json');
	echo json_encode(['error' => 'access_denied']);
	exit;
}

//set content type
header('Content-Type: application/json');

//only accept POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
	echo json_encode(['error' => 'method_not_allowed']);
	exit;
}

//get posted data
$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input) || empty($input['report'])) {
	echo json_encode(['error' => 'missing_report']);
	exit;
}

$report_text = $input['report'];
$report_html = $input['report_html'] ?? '';

//get user info
$user_email = $_SESSION['user_email'] ?? '';
$username = $_SESSION['username'] ?? 'Unknown User';
$domain_name = $_SESSION['domain_name'] ?? 'Unknown Domain';
$extension = $input['extension'] ?? '';

//recipient
$to = 'info@voipegypt.net';

//subject
$subject = "WebRTC Phone Network Report - " . $domain_name;
if ($extension) {
	$subject .= " (Ext: " . $extension . ")";
}

//build email
$boundary = md5(uniqid(time()));
$headers = "From: " . ($user_email ? $user_email : "noreply@" . $domain_name) . "\r\n";
$headers .= "Reply-To: " . ($user_email ? $user_email : "noreply@" . $domain_name) . "\r\n";
$headers .= "MIME-Version: 1.0\r\n";
$headers .= "Content-Type: multipart/alternative; boundary=\"" . $boundary . "\"\r\n";
$headers .= "X-Mailer: FusionPBX-WebRTC-Phone\r\n";

$body = "--" . $boundary . "\r\n";
$body .= "Content-Type: text/plain; charset=UTF-8\r\n";
$body .= "Content-Transfer-Encoding: 8bit\r\n\r\n";
$body .= $report_text . "\r\n\r\n";
$body .= "--" . $boundary . "\r\n";
$body .= "Content-Type: text/html; charset=UTF-8\r\n";
$body .= "Content-Transfer-Encoding: 8bit\r\n\r\n";

if (!empty($report_html)) {
	$body .= $report_html . "\r\n";
} else {
	$body .= "<html><body><pre>" . htmlspecialchars($report_text) . "</pre></body></html>\r\n";
}

$body .= "--" . $boundary . "--\r\n";

//try FusionPBX email class first, fall back to mail()
$sent = false;

//check if FusionPBX email class exists
if (class_exists('email')) {
	try {
		$email = new email;
		$email->recipients = $to;
		$email->subject = $subject;
		$email->body = !empty($report_html) ? $report_html : "<pre>" . htmlspecialchars($report_text) . "</pre>";
		$email->from_address = $user_email ? $user_email : "noreply@" . $domain_name;
		$email->from_name = $username . " (" . $domain_name . ")";
		$sent = $email->send();
	} catch (Exception $e) {
		//fall back to mail()
	}
}

if (!$sent) {
	$sent = @mail($to, $subject, $body, $headers);
}

if ($sent) {
	echo json_encode(['success' => true, 'message' => 'Report sent to ' . $to]);
} else {
	echo json_encode(['error' => 'send_failed', 'message' => 'Failed to send email. Check server mail configuration.']);
}

?>
