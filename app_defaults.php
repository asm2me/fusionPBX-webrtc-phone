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

	//create click-to-dial tokens table
	$sql = "CREATE TABLE IF NOT EXISTS v_click_to_dial_tokens ( ";
	$sql .= "click_to_dial_token_uuid uuid PRIMARY KEY, ";
	$sql .= "domain_uuid uuid NOT NULL, ";
	$sql .= "extension_uuid uuid NOT NULL, ";
	$sql .= "api_token varchar(128) NOT NULL UNIQUE, ";
	$sql .= "token_name varchar(255), ";
	$sql .= "allowed_origins text, ";
	$sql .= "destination_number varchar(64) DEFAULT '', ";
	$sql .= "departments text DEFAULT '', ";
	$sql .= "button_color varchar(20) DEFAULT '#1a73e8', ";
	$sql .= "button_position varchar(20) DEFAULT 'bottom-right', ";
	$sql .= "button_label varchar(100) DEFAULT '', ";
	$sql .= "token_enabled varchar(10) DEFAULT 'true', ";
	$sql .= "insert_date timestamptz DEFAULT now(), ";
	$sql .= "insert_user uuid, ";
	$sql .= "update_date timestamptz, ";
	$sql .= "update_user uuid ";
	$sql .= ") ";
	$database = new database;
	$database->execute($sql);
	unset($sql);

	//add destination_number and departments columns if they don't exist (upgrade path)
	$sql = "ALTER TABLE v_click_to_dial_tokens ADD COLUMN IF NOT EXISTS destination_number varchar(64) DEFAULT '' ";
	$database->execute($sql);
	$sql = "ALTER TABLE v_click_to_dial_tokens ADD COLUMN IF NOT EXISTS departments text DEFAULT '' ";
	$database->execute($sql);
	unset($sql);
}

?>
