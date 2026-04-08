<?php

/*
	FusionPBX
	Version: MPL 1.1
	Copyright (c) VOIPEGYPT - https://voipegypt.com

	WebRTC Phone - Default Settings
	This file is executed during the upgrade process to apply default settings.
*/

if ($domains_processed == 1) {

	//remove stale menu items (wrong parent or old UUIDs from previous installs)
	$database = new database;
	$known_menu_uuids = [
		'e5f6a7b8-c9d0-1234-efab-345678901234', //WebRTC Phone
		'f6a7b8c9-d0e1-2345-fabc-456789012345', //Click-to-Dial Setup
		'a7b8c9d0-e1f2-3456-abcd-567890123457', //CRM Integration
	];
	$placeholders = implode(',', array_map(fn($i) => ":uuid{$i}", array_keys($known_menu_uuids)));
	$params = [];
	foreach ($known_menu_uuids as $i => $u) { $params["uuid{$i}"] = $u; }
	$sql = "DELETE FROM v_menu_items
	        WHERE menu_item_link IN (
	            '/app/web_phone2/webrtc_phone.php',
	            '/app/web_phone2/click_to_dial/click_to_dial_setup.php',
	            '/app/web_phone2/crm_settings.php'
	        )
	        AND menu_item_uuid NOT IN ({$placeholders})";
	$database->execute($sql, $params);
	unset($sql, $params, $placeholders, $known_menu_uuids);

	//default settings
	$y = 0;

	$array['default_settings'][$y]['default_setting_uuid'] = "b2c3d4e5-f6a7-8901-bcde-f12345678902";
	$array['default_settings'][$y]['default_setting_category'] = "webrtc_phone";
	$array['default_settings'][$y]['default_setting_subcategory'] = "wss_port";
	$array['default_settings'][$y]['default_setting_name'] = "text";
	$array['default_settings'][$y]['default_setting_value'] = "7443";
	$array['default_settings'][$y]['default_setting_enabled'] = "true";
	$array['default_settings'][$y]['default_setting_description'] = "WebSocket Secure port for SIP over WSS.";
	$y++;

	$array['default_settings'][$y]['default_setting_uuid'] = "3c8f2e1a-0001-0002-0001-7d2b0f1e4c8b";
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
	$y++;

	$array['default_settings'][$y]['default_setting_uuid'] = "b8c9d0e1-f2a3-4567-bcde-678901234567";
	$array['default_settings'][$y]['default_setting_category'] = "webrtc_phone";
	$array['default_settings'][$y]['default_setting_subcategory'] = "crm_url";
	$array['default_settings'][$y]['default_setting_name'] = "text";
	$array['default_settings'][$y]['default_setting_value'] = "";
	$array['default_settings'][$y]['default_setting_enabled'] = "false";
	$array['default_settings'][$y]['default_setting_description'] = "CRM webhook URL with placeholders: {event} {caller_id} {destination} {direction} {duration} {extension} {call_id} {timestamp}";
	$y++;

	$array['default_settings'][$y]['default_setting_uuid'] = "c9d0e1f2-a3b4-5678-cdef-789012345678";
	$array['default_settings'][$y]['default_setting_category'] = "webrtc_phone";
	$array['default_settings'][$y]['default_setting_subcategory'] = "crm_method";
	$array['default_settings'][$y]['default_setting_name'] = "text";
	$array['default_settings'][$y]['default_setting_value'] = "GET";
	$array['default_settings'][$y]['default_setting_enabled'] = "false";
	$array['default_settings'][$y]['default_setting_description'] = "CRM webhook HTTP method: GET or POST.";
	$y++;

	$array['default_settings'][$y]['default_setting_uuid'] = "d0e1f2a3-b4c5-6789-defa-890123456789";
	$array['default_settings'][$y]['default_setting_category'] = "webrtc_phone";
	$array['default_settings'][$y]['default_setting_subcategory'] = "crm_login_url";
	$array['default_settings'][$y]['default_setting_name'] = "text";
	$array['default_settings'][$y]['default_setting_value'] = "";
	$array['default_settings'][$y]['default_setting_enabled'] = "false";
	$array['default_settings'][$y]['default_setting_description'] = "CRM screen-pop URL opened on incoming call. Placeholders: {caller_id} {caller_name} {destination} {extension} {call_id} {timestamp}";

	//add or update the default settings
	$p = new permissions;
	$p->add("default_setting_add", "temp");
	$p->add("default_setting_edit", "temp");

	$database = new database;
	$database->app_name = "webrtc_phone";
	$database->app_uuid = "3c8f2e1a-9b4d-4f7e-a6c5-7d2b0f1e4c8b";
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
	$sql .= "destinations text DEFAULT '[]', ";
	$sql .= "lazy_registration varchar(10) DEFAULT 'false', ";
	$sql .= "show_dtmf varchar(10) DEFAULT 'true', ";
	$sql .= "button_shadow varchar(20) DEFAULT 'normal', ";
	$sql .= "button_orientation varchar(20) DEFAULT 'horizontal', ";
	$sql .= "button_style varchar(20) DEFAULT 'pill', ";
	$sql .= "form_style varchar(20) DEFAULT 'default', ";
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

	//add destinations, lazy_registration, and show_dtmf columns if they don't exist (upgrade path)
	$sql = "ALTER TABLE v_click_to_dial_tokens ADD COLUMN IF NOT EXISTS destinations text DEFAULT '[]' ";
	$database->execute($sql);
	$sql = "ALTER TABLE v_click_to_dial_tokens ADD COLUMN IF NOT EXISTS lazy_registration varchar(10) DEFAULT 'false' ";
	$database->execute($sql);
	$sql = "ALTER TABLE v_click_to_dial_tokens ADD COLUMN IF NOT EXISTS show_dtmf varchar(10) DEFAULT 'true' ";
	$database->execute($sql);
	$sql = "ALTER TABLE v_click_to_dial_tokens ADD COLUMN IF NOT EXISTS button_shadow varchar(20) DEFAULT 'normal' ";
	$database->execute($sql);
	$sql = "ALTER TABLE v_click_to_dial_tokens ADD COLUMN IF NOT EXISTS button_orientation varchar(20) DEFAULT 'horizontal' ";
	$database->execute($sql);
	$sql = "ALTER TABLE v_click_to_dial_tokens ADD COLUMN IF NOT EXISTS button_style varchar(20) DEFAULT 'pill' ";
	$database->execute($sql);
	$sql = "ALTER TABLE v_click_to_dial_tokens ADD COLUMN IF NOT EXISTS form_style varchar(20) DEFAULT 'default' ";
	$database->execute($sql);
	unset($sql);
}

?>
