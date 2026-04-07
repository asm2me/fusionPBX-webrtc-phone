<?php

/*
	FusionPBX
	Version: MPL 1.1
	Copyright (c) VOIPEGYPT - https://voipegypt.com

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

//html body
$html_body = !empty($report_html) ? $report_html : "<html><body><pre>" . htmlspecialchars($report_text) . "</pre></body></html>";

//get SMTP settings from FusionPBX default settings
$smtp_host = $_SESSION['email']['smtp_host']['text'] ?? '';
$smtp_port = $_SESSION['email']['smtp_port']['numeric'] ?? '';
$smtp_from = $_SESSION['email']['smtp_from']['text'] ?? '';
$smtp_from_name = $_SESSION['email']['smtp_from_name']['text'] ?? '';
$smtp_user = $_SESSION['email']['smtp_username']['text'] ?? ($_SESSION['email']['smtp_user']['text'] ?? '');
$smtp_pass = $_SESSION['email']['smtp_password']['text'] ?? ($_SESSION['email']['smtp_pass']['text'] ?? '');
$smtp_secure = $_SESSION['email']['smtp_secure']['text'] ?? 'tls';
$smtp_auth = $_SESSION['email']['smtp_auth']['text'] ?? 'true';

$sent = false;
$error_msg = '';

// Method 1: Try FusionPBX email class
if (!$sent && class_exists('email')) {
	try {
		$email_obj = new email;
		$email_obj->recipients = $to;
		$email_obj->subject = $subject;
		$email_obj->body = $html_body;
		$email_obj->from_address = $smtp_from ?: ($user_email ?: "noreply@" . $domain_name);
		$email_obj->from_name = $username . " (" . $domain_name . ")";
		$result = $email_obj->send();
		if ($result) {
			$sent = true;
		} else {
			$error_msg = 'FusionPBX email class returned false';
		}
	} catch (Exception $e) {
		$error_msg = 'Email class: ' . $e->getMessage();
	}
}

// Method 2: Try PHPMailer directly if available
if (!$sent) {
	$phpmailer_paths = [
		$document_root . '/resources/classes/phpmailer/src/PHPMailer.php',
		$document_root . '/resources/classes/phpmailer/PHPMailer.php',
		$document_root . '/vendor/phpmailer/phpmailer/src/PHPMailer.php',
	];
	$phpmailer_loaded = false;
	foreach ($phpmailer_paths as $path) {
		if (file_exists($path)) {
			require_once $path;
			// Also load SMTP class
			$smtp_path = dirname($path) . '/SMTP.php';
			if (file_exists($smtp_path)) require_once $smtp_path;
			$exception_path = dirname($path) . '/Exception.php';
			if (file_exists($exception_path)) require_once $exception_path;
			$phpmailer_loaded = true;
			break;
		}
	}

	if ($phpmailer_loaded && !empty($smtp_host)) {
		try {
			$mailer_class = class_exists('PHPMailer\\PHPMailer\\PHPMailer') ? 'PHPMailer\\PHPMailer\\PHPMailer' : (class_exists('PHPMailer') ? 'PHPMailer' : '');
			if ($mailer_class) {
				$mail = new $mailer_class(true);
				$mail->isSMTP();
				$mail->Host = $smtp_host;
				$mail->Port = intval($smtp_port ?: 587);
				if ($smtp_auth === 'true' && !empty($smtp_user)) {
					$mail->SMTPAuth = true;
					$mail->Username = $smtp_user;
					$mail->Password = $smtp_pass;
				}
				if ($smtp_secure === 'tls') {
					$mail->SMTPSecure = 'tls';
				} elseif ($smtp_secure === 'ssl') {
					$mail->SMTPSecure = 'ssl';
				}
				$mail->CharSet = 'UTF-8';
				$mail->setFrom($smtp_from ?: ($user_email ?: "noreply@" . $domain_name), $username . " (" . $domain_name . ")");
				$mail->addAddress($to);
				$mail->Subject = $subject;
				$mail->isHTML(true);
				$mail->Body = $html_body;
				$mail->AltBody = $report_text;
				$sent = $mail->send();
				if (!$sent) {
					$error_msg = 'PHPMailer: ' . $mail->ErrorInfo;
				}
			}
		} catch (Exception $e) {
			$error_msg = 'PHPMailer: ' . $e->getMessage();
		}
	}
}

// Method 3: PHP mail() as final fallback
if (!$sent) {
	$boundary = md5(uniqid(time()));
	$headers = "From: " . ($smtp_from ?: ($user_email ?: "noreply@" . $domain_name)) . "\r\n";
	$headers .= "Reply-To: " . ($user_email ?: "noreply@" . $domain_name) . "\r\n";
	$headers .= "MIME-Version: 1.0\r\n";
	$headers .= "Content-Type: multipart/alternative; boundary=\"" . $boundary . "\"\r\n";

	$body = "--" . $boundary . "\r\n";
	$body .= "Content-Type: text/plain; charset=UTF-8\r\n";
	$body .= "Content-Transfer-Encoding: 8bit\r\n\r\n";
	$body .= $report_text . "\r\n\r\n";
	$body .= "--" . $boundary . "\r\n";
	$body .= "Content-Type: text/html; charset=UTF-8\r\n";
	$body .= "Content-Transfer-Encoding: 8bit\r\n\r\n";
	$body .= $html_body . "\r\n";
	$body .= "--" . $boundary . "--\r\n";

	$sent = @mail($to, $subject, $body, $headers);
	if (!$sent) {
		$error_msg = ($error_msg ? $error_msg . '. ' : '') . 'PHP mail() also failed. Check SMTP config in Advanced > Default Settings > Email.';
	}
}

if ($sent) {
	echo json_encode(['success' => true, 'message' => 'Report sent to ' . $to]);
} else {
	echo json_encode([
		'error' => 'send_failed',
		'message' => $error_msg ?: 'Failed to send email. Configure SMTP in Advanced > Default Settings > Email.',
		'smtp_configured' => !empty($smtp_host),
		'smtp_host' => !empty($smtp_host) ? $smtp_host : 'not configured'
	]);
}

?>
