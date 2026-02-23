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
echo "<script>document.addEventListener('DOMContentLoaded', function(){ WebRTCPhone.init('webrtc-phone-mount'); });</script>\n";

require_once "resources/footer.php";

?>
