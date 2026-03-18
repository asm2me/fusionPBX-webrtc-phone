<?php

	//application details
	$apps[$x]['name'] = "WebRTC Phone";
	$apps[$x]['uuid'] = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
	$apps[$x]['category'] = "Switch";
	$apps[$x]['subcategory'] = "";
	$apps[$x]['version'] = "1.0.0";
	$apps[$x]['license'] = "Mozilla Public License 1.1";
	$apps[$x]['url'] = "https://www.fusionpbx.com";
	$apps[$x]['description']['en-us'] = "A WebRTC-based softphone that runs in the browser. Uses the active user's extensions for SIP registration via WebSocket.";

	//permission groups
	$y = 0;
	$apps[$x]['permissions'][$y]['name'] = "webrtc_phone_view";
	$apps[$x]['permissions'][$y]['groups'][] = "superadmin";
	$apps[$x]['permissions'][$y]['groups'][] = "admin";
	$apps[$x]['permissions'][$y]['groups'][] = "user";
	$y++;

	$apps[$x]['permissions'][$y]['name'] = "click_to_dial_view";
	$apps[$x]['permissions'][$y]['groups'][] = "superadmin";
	$apps[$x]['permissions'][$y]['groups'][] = "admin";
	$y++;

	$apps[$x]['permissions'][$y]['name'] = "click_to_dial_edit";
	$apps[$x]['permissions'][$y]['groups'][] = "superadmin";
	$apps[$x]['permissions'][$y]['groups'][] = "admin";
	$y++;

	$apps[$x]['permissions'][$y]['name'] = "click_to_dial_delete";
	$apps[$x]['permissions'][$y]['groups'][] = "superadmin";
	$apps[$x]['permissions'][$y]['groups'][] = "admin";

	//default settings
	$y = 0;
	$apps[$x]['default_settings'][$y]['default_setting_uuid'] = "b2c3d4e5-f6a7-8901-bcde-f12345678901";
	$apps[$x]['default_settings'][$y]['default_setting_category'] = "webrtc_phone";
	$apps[$x]['default_settings'][$y]['default_setting_subcategory'] = "wss_port";
	$apps[$x]['default_settings'][$y]['default_setting_name'] = "text";
	$apps[$x]['default_settings'][$y]['default_setting_value'] = "7443";
	$apps[$x]['default_settings'][$y]['default_setting_enabled'] = "true";
	$apps[$x]['default_settings'][$y]['default_setting_description'] = "WebSocket Secure port for SIP over WSS.";
	$y++;

	$apps[$x]['default_settings'][$y]['default_setting_uuid'] = "c3d4e5f6-a7b8-9012-cdef-123456789012";
	$apps[$x]['default_settings'][$y]['default_setting_category'] = "webrtc_phone";
	$apps[$x]['default_settings'][$y]['default_setting_subcategory'] = "enabled";
	$apps[$x]['default_settings'][$y]['default_setting_name'] = "boolean";
	$apps[$x]['default_settings'][$y]['default_setting_value'] = "true";
	$apps[$x]['default_settings'][$y]['default_setting_enabled'] = "true";
	$apps[$x]['default_settings'][$y]['default_setting_description'] = "Enable or disable the WebRTC phone globally.";
	$y++;

	$apps[$x]['default_settings'][$y]['default_setting_uuid'] = "d4e5f6a7-b8c9-0123-defa-234567890123";
	$apps[$x]['default_settings'][$y]['default_setting_category'] = "webrtc_phone";
	$apps[$x]['default_settings'][$y]['default_setting_subcategory'] = "stun_server";
	$apps[$x]['default_settings'][$y]['default_setting_name'] = "text";
	$apps[$x]['default_settings'][$y]['default_setting_value'] = "stun:stun.l.google.com:19302";
	$apps[$x]['default_settings'][$y]['default_setting_enabled'] = "true";
	$apps[$x]['default_settings'][$y]['default_setting_description'] = "STUN server for NAT traversal.";
	$y++;

	$apps[$x]['default_settings'][$y]['default_setting_uuid'] = "e5f6a7b8-c9d0-1234-efab-345678901234";
	$apps[$x]['default_settings'][$y]['default_setting_category'] = "webrtc_phone";
	$apps[$x]['default_settings'][$y]['default_setting_subcategory'] = "turn_server";
	$apps[$x]['default_settings'][$y]['default_setting_name'] = "text";
	$apps[$x]['default_settings'][$y]['default_setting_value'] = "";
	$apps[$x]['default_settings'][$y]['default_setting_enabled'] = "false";
	$apps[$x]['default_settings'][$y]['default_setting_description'] = "TURN server URL (e.g. turn:mt.voipat.com:3478). Leave empty to disable.";
	$y++;

	$apps[$x]['default_settings'][$y]['default_setting_uuid'] = "f6a7b8c9-d0e1-2345-fabc-456789012345";
	$apps[$x]['default_settings'][$y]['default_setting_category'] = "webrtc_phone";
	$apps[$x]['default_settings'][$y]['default_setting_subcategory'] = "turn_username";
	$apps[$x]['default_settings'][$y]['default_setting_name'] = "text";
	$apps[$x]['default_settings'][$y]['default_setting_value'] = "";
	$apps[$x]['default_settings'][$y]['default_setting_enabled'] = "false";
	$apps[$x]['default_settings'][$y]['default_setting_description'] = "TURN server username for authentication.";
	$y++;

	$apps[$x]['default_settings'][$y]['default_setting_uuid'] = "a7b8c9d0-e1f2-3456-abcd-567890123456";
	$apps[$x]['default_settings'][$y]['default_setting_category'] = "webrtc_phone";
	$apps[$x]['default_settings'][$y]['default_setting_subcategory'] = "turn_password";
	$apps[$x]['default_settings'][$y]['default_setting_name'] = "text";
	$apps[$x]['default_settings'][$y]['default_setting_value'] = "";
	$apps[$x]['default_settings'][$y]['default_setting_enabled'] = "false";
	$apps[$x]['default_settings'][$y]['default_setting_description'] = "TURN server password for authentication.";
	$y++;

	$apps[$x]['default_settings'][$y]['default_setting_uuid'] = "b8c9d0e1-f2a3-4567-bcde-678901234567";
	$apps[$x]['default_settings'][$y]['default_setting_category'] = "webrtc_phone";
	$apps[$x]['default_settings'][$y]['default_setting_subcategory'] = "crm_url";
	$apps[$x]['default_settings'][$y]['default_setting_name'] = "text";
	$apps[$x]['default_settings'][$y]['default_setting_value'] = "";
	$apps[$x]['default_settings'][$y]['default_setting_enabled'] = "false";
	$apps[$x]['default_settings'][$y]['default_setting_description'] = "CRM webhook URL with placeholders: {event} {caller_id} {destination} {direction} {duration} {extension} {call_id} {timestamp}";
	$y++;

	$apps[$x]['default_settings'][$y]['default_setting_uuid'] = "c9d0e1f2-a3b4-5678-cdef-789012345678";
	$apps[$x]['default_settings'][$y]['default_setting_category'] = "webrtc_phone";
	$apps[$x]['default_settings'][$y]['default_setting_subcategory'] = "crm_method";
	$apps[$x]['default_settings'][$y]['default_setting_name'] = "text";
	$apps[$x]['default_settings'][$y]['default_setting_value'] = "GET";
	$apps[$x]['default_settings'][$y]['default_setting_enabled'] = "false";
	$apps[$x]['default_settings'][$y]['default_setting_description'] = "CRM webhook HTTP method: GET or POST.";

?>
