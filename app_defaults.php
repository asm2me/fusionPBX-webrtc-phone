<?php

/*
	FusionPBX
	Version: MPL 1.1

	WebRTC Phone - Default Settings
	This file is executed during the upgrade process to apply default settings.
*/

if ($domains_processed == 1) {

	//default settings
	$y = 0;

	$array['default_settings'][$y]['default_setting_uuid'] = "b2c3d4e5-f6a7-8901-bcde-f12345678901";
	$array['default_settings'][$y]['default_setting_category'] = "webrtc_phone";
	$array['default_settings'][$y]['default_setting_subcategory'] = "wss_port";
	$array['default_settings'][$y]['default_setting_name'] = "text";
	$array['default_settings'][$y]['default_setting_value'] = "7443";
	$array['default_settings'][$y]['default_setting_enabled'] = "true";
	$array['default_settings'][$y]['default_setting_description'] = "WebSocket Secure port for SIP over WSS.";
	$y++;

	$array['default_settings'][$y]['default_setting_uuid'] = "c3d4e5f6-a7b8-9012-cdef-123456789012";
	$array['default_settings'][$y]['default_setting_category'] = "webrtc_phone";
	$array['default_settings'][$y]['default_setting_subcategory'] = "enabled";
	$array['default_settings'][$y]['default_setting_name'] = "boolean";
	$array['default_settings'][$y]['default_setting_value'] = "true";
	$array['default_settings'][$y]['default_setting_enabled'] = "true";
	$array['default_settings'][$y]['default_setting_description'] = "Enable or disable the WebRTC phone globally.";
	$y++;

	$array['default_settings'][$y]['default_setting_uuid'] = "d4e5f6a7-b8c9-0123-defa-234567890123";
	$array['default_settings'][$y]['default_setting_category'] = "webrtc_phone";
	$array['default_settings'][$y]['default_setting_subcategory'] = "stun_server";
	$array['default_settings'][$y]['default_setting_name'] = "text";
	$array['default_settings'][$y]['default_setting_value'] = "stun:stun.l.google.com:19302";
	$array['default_settings'][$y]['default_setting_enabled'] = "true";
	$array['default_settings'][$y]['default_setting_description'] = "STUN server for NAT traversal.";

	//add or update the default settings
	$p = new permissions;
	$p->add("default_setting_add", "temp");
	$p->add("default_setting_edit", "temp");

	$database = new database;
	$database->app_name = "webrtc_phone";
	$database->app_uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
	$database->save($array);
	unset($array);

	$p->delete("default_setting_add", "temp");
	$p->delete("default_setting_edit", "temp");
}

?>
