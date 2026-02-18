<?php

/*
	FusionPBX
	Version: MPL 1.1

	WebRTC Phone - Include File
	Add this to the FusionPBX template footer to inject the floating phone on every page.

	Installation: Add to your FusionPBX theme footer (e.g., resources/footer.php) before </body>:
	  <?php if (file_exists($_SERVER['DOCUMENT_ROOT'].'/app/webrtc_phone/webrtc_phone_inc.php')) { include $_SERVER['DOCUMENT_ROOT'].'/app/webrtc_phone/webrtc_phone_inc.php'; } ?>
*/

// -----------------------------------------------------------------------
// DEBUG MODE  –  set to true temporarily to trace what this file detects.
// Set back to false (or remove) before going to production.
$_webrtc_debug = false;
// -----------------------------------------------------------------------

// Skip injection on pages where the phone scripts may conflict with native FusionPBX UI
$_webrtc_script      = $_SERVER['SCRIPT_FILENAME'] ?? '';
$_webrtc_uri         = $_SERVER['REQUEST_URI']      ?? '';
$_webrtc_excluded_apps = ['extensions', 'extension_edit', 'xml_cdr', 'operator_panel'];
$_webrtc_current_app = basename(dirname($_webrtc_script));
$_webrtc_excluded    = in_array($_webrtc_current_app, $_webrtc_excluded_apps);

if ($_webrtc_debug) {
	echo "<!-- [webrtc_phone_inc] SCRIPT_FILENAME=" . htmlspecialchars($_webrtc_script) . " -->\n";
	echo "<!-- [webrtc_phone_inc] REQUEST_URI=" . htmlspecialchars($_webrtc_uri) . " -->\n";
	echo "<!-- [webrtc_phone_inc] current_app=" . htmlspecialchars($_webrtc_current_app) . " -->\n";
	echo "<!-- [webrtc_phone_inc] excluded=" . ($_webrtc_excluded ? 'YES – phone will NOT be injected' : 'NO – phone WILL be injected') . " -->\n";
	echo "<!-- [webrtc_phone_inc] has_permission=" . (permission_exists('webrtc_phone_view') ? 'YES' : 'NO') . " -->\n";
}

if ($_webrtc_excluded) {
	if ($_webrtc_debug) {
		echo "<!-- [webrtc_phone_inc] Skipping injection on this page -->\n";
	}
	unset($_webrtc_debug, $_webrtc_script, $_webrtc_uri, $_webrtc_excluded_apps, $_webrtc_current_app, $_webrtc_excluded);
	return;
}
unset($_webrtc_debug, $_webrtc_script, $_webrtc_uri, $_webrtc_excluded_apps, $_webrtc_current_app, $_webrtc_excluded);

if (isset($_SESSION['user_uuid']) && permission_exists('webrtc_phone_view')) {
	$webrtc_enabled = $_SESSION['webrtc_phone']['enabled']['boolean'] ?? 'true';
	if ($webrtc_enabled === 'true') {
		$v = '1.0.4';
		echo "\n<!-- WebRTC Phone Floating Overlay -->\n";
		echo "<link rel='stylesheet' href='/app/webrtc_phone/resources/css/webrtc_phone.css?v=".$v."'>\n";
		echo "<div id='webrtc-phone-floating-container'>\n";
		echo "	<button id='webrtc-phone-fab' onclick='WebRTCPhone.toggle()' title='Phone'>\n";
		echo "		<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z'/></svg>\n";
		echo "		<span id='webrtc-phone-fab-badge' class='webrtc-badge hidden'></span>\n";
		echo "	</button>\n";
		echo "	<div id='webrtc-phone-panel' class='webrtc-phone-panel hidden'>\n";
		echo "		<div id='webrtc-phone-mount'></div>\n";
		echo "	</div>\n";
		echo "</div>\n";
		echo "<script src='/app/webrtc_phone/resources/js/jssip.min.js?v=".$v."'></script>\n";
		echo "<script src='/app/webrtc_phone/resources/js/webrtc_phone.js?v=".$v."'></script>\n";
		echo "<script>document.addEventListener('DOMContentLoaded', function(){ WebRTCPhone.init('webrtc-phone-mount'); });</script>\n";
	}
}

?>
