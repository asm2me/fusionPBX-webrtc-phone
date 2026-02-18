<?php

/*
	FusionPBX
	Version: MPL 1.1

	Web Phone 2 - Main Page
	Standalone page for the WebRTC phone (also loadable via the persistent overlay).
*/

//includes
$document_root = dirname(__DIR__, 2);
require_once $document_root."/resources/require.php";
require_once $document_root."/resources/check_auth.php";

//check permissions
if (!permission_exists('web_phone2_view')) {
	echo "access denied";
	exit;
}

//add multi-lingual support
$language = new text;
$text = $language->get();

//include header if loaded as a full page
$document['title'] = $text['title-web_phone2'];
require_once "resources/header.php";

echo "<div id='web-phone2-standalone'>\n";
echo "	<div id='web-phone2-mount'></div>\n";
echo "</div>\n";

$v = '1.0.4';
echo "<script src='/app/web_phone2/resources/js/jssip.min.js?v=".$v."'></script>\n";
echo "<script src='/app/web_phone2/resources/js/web_phone2.js?v=".$v."'></script>\n";
echo "<link rel='stylesheet' href='/app/web_phone2/resources/css/web_phone2.css?v=".$v."'>\n";
echo "<script>document.addEventListener('DOMContentLoaded', function(){ WebPhone2.init('web-phone2-mount'); });</script>\n";

require_once "resources/footer.php";

?>
