<?php

/*
	FusionPBX
	Version: MPL 1.1

	WebRTC Phone - Main Page
	Standalone page for the WebRTC phone (also loadable via the persistent overlay).
*/

//includes
$document_root = dirname(__DIR__, 2);
require_once $document_root."/resources/require.php";
require_once $document_root."/resources/check_auth.php";

//check permissions
if (!permission_exists('webrtc_phone_view')) {
	echo "access denied";
	exit;
}

//add multi-lingual support
$language = new text;
$text = $language->get();

//include header if loaded as a full page
$document['title'] = $text['title-webrtc_phone'];
require_once "resources/header.php";

echo "<div id='webrtc-phone-standalone'>\n";
echo "	<div id='webrtc-phone-mount'></div>\n";
echo "</div>\n";

$v = '1.0.4';
echo "<script src='/app/webrtc_phone/resources/js/jssip.min.js?v=".$v."'></script>\n";
echo "<script src='/app/webrtc_phone/resources/js/webrtc_phone.js?v=".$v."'></script>\n";
echo "<link rel='stylesheet' href='/app/webrtc_phone/resources/css/webrtc_phone.css?v=".$v."'>\n";

// Inject translations for the JS UI
$_webrtc_lang = $_SESSION['domain']['language']['code'] ?? 'en-us';
$_webrtc_js_strings = [];
foreach ($text as $key => $langs) {
	if (strpos($key, 'js-') === 0) {
		$jsKey = substr($key, 3);
		$_webrtc_js_strings[$jsKey] = is_array($langs) ? ($langs[$_webrtc_lang] ?? ($langs['en-us'] ?? '')) : '';
	}
}
if (!empty($_webrtc_js_strings)) {
	echo "<script>window.webrtcPhoneLang = ".json_encode($_webrtc_js_strings, JSON_UNESCAPED_UNICODE).";</script>\n";
}

echo "<script>document.addEventListener('DOMContentLoaded', function(){ WebRTCPhone.init('webrtc-phone-mount'); });</script>\n";

require_once "resources/footer.php";

?>
