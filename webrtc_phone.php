<?php

/*
	FusionPBX
	Version: MPL 1.1
	Copyright (c) VOIPEGYPT - https://voipegypt.com

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

$v = '1.2.9';
echo "<script src='/app/web_phone2/resources/js/jssip.min.js?v=".$v."'></script>\n";
echo "<script src='/app/web_phone2/resources/js/webrtc_phone.min.js?v=".$v."'></script>\n";
echo "<link rel='stylesheet' href='/app/web_phone2/resources/css/webrtc_phone.css?v=".$v."'>\n";

// Inject translations for the JS UI
$_webrtc_lang = 'en-us';
if (!empty($_SESSION['domain']['language']['code'])) {
	$_webrtc_lang = $_SESSION['domain']['language']['code'];
} elseif (!empty($_SESSION['language'])) {
	$_webrtc_lang = $_SESSION['language'];
}

// Load our translations fresh (isolated from the page's $text)
$_webrtc_text = [];
(function() use (&$_webrtc_text) {
	$text = [];
	require __DIR__.'/app_languages.php';
	$_webrtc_text = $text;
})();

$_webrtc_js_strings = [];
foreach ($_webrtc_text as $_wk => $_wv) {
	if (strpos($_wk, 'js-') === 0 && is_array($_wv)) {
		$_jk = substr($_wk, 3);
		if (isset($_wv[$_webrtc_lang])) {
			$_webrtc_js_strings[$_jk] = $_wv[$_webrtc_lang];
		} elseif (isset($_wv['en-us'])) {
			$_webrtc_js_strings[$_jk] = $_wv['en-us'];
		}
	}
}
unset($_webrtc_text, $_wk, $_wv, $_jk);

echo "<!-- webrtc_phone lang: ".htmlspecialchars($_webrtc_lang)." keys: ".count($_webrtc_js_strings)." -->\n";
echo "<script>window.webrtcPhoneLang = ".json_encode($_webrtc_js_strings, JSON_UNESCAPED_UNICODE).";</script>\n";
unset($_webrtc_js_strings, $_webrtc_lang);

echo "<script>document.addEventListener('DOMContentLoaded', function(){ WebRTCPhone.init('webrtc-phone-mount'); });</script>\n";

require_once "resources/footer.php";

?>
