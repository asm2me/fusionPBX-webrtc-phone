<?php

	//application details
	$apps[$x]['name'] = "Web Phone 2";
	$apps[$x]['uuid'] = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
	$apps[$x]['category'] = "Switch";
	$apps[$x]['subcategory'] = "";
	$apps[$x]['version'] = "1.0.0";
	$apps[$x]['license'] = "Mozilla Public License 1.1";
	$apps[$x]['url'] = "https://www.fusionpbx.com";
	$apps[$x]['description']['en-us'] = "A WebRTC-based softphone that runs in the browser. Uses the active user's extensions for SIP registration via WebSocket.";

	//permission groups
	$y = 0;
	$apps[$x]['permissions'][$y]['name'] = "web_phone2_view";
	$apps[$x]['permissions'][$y]['groups'][] = "superadmin";
	$apps[$x]['permissions'][$y]['groups'][] = "admin";
	$apps[$x]['permissions'][$y]['groups'][] = "user";

	//default settings
	$y = 0;
	$apps[$x]['default_settings'][$y]['default_setting_uuid'] = "b2c3d4e5-f6a7-8901-bcde-f12345678901";
	$apps[$x]['default_settings'][$y]['default_setting_category'] = "web_phone2";
	$apps[$x]['default_settings'][$y]['default_setting_subcategory'] = "wss_port";
	$apps[$x]['default_settings'][$y]['default_setting_name'] = "text";
	$apps[$x]['default_settings'][$y]['default_setting_value'] = "7443";
	$apps[$x]['default_settings'][$y]['default_setting_enabled'] = "true";
	$apps[$x]['default_settings'][$y]['default_setting_description'] = "WebSocket Secure port for SIP over WSS.";
	$y++;

	$apps[$x]['default_settings'][$y]['default_setting_uuid'] = "c3d4e5f6-a7b8-9012-cdef-123456789012";
	$apps[$x]['default_settings'][$y]['default_setting_category'] = "web_phone2";
	$apps[$x]['default_settings'][$y]['default_setting_subcategory'] = "enabled";
	$apps[$x]['default_settings'][$y]['default_setting_name'] = "boolean";
	$apps[$x]['default_settings'][$y]['default_setting_value'] = "true";
	$apps[$x]['default_settings'][$y]['default_setting_enabled'] = "true";
	$apps[$x]['default_settings'][$y]['default_setting_description'] = "Enable or disable the WebRTC phone globally.";
	$y++;

	$apps[$x]['default_settings'][$y]['default_setting_uuid'] = "d4e5f6a7-b8c9-0123-defa-234567890123";
	$apps[$x]['default_settings'][$y]['default_setting_category'] = "web_phone2";
	$apps[$x]['default_settings'][$y]['default_setting_subcategory'] = "stun_server";
	$apps[$x]['default_settings'][$y]['default_setting_name'] = "text";
	$apps[$x]['default_settings'][$y]['default_setting_value'] = "stun:stun.l.google.com:19302";
	$apps[$x]['default_settings'][$y]['default_setting_enabled'] = "true";
	$apps[$x]['default_settings'][$y]['default_setting_description'] = "STUN server for NAT traversal.";

?>
