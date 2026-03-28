<?php

	$y = 0;
	$apps[$x]['menu'][$y]['title']['en-us'] = "WebRTC Phone";
	$apps[$x]['menu'][$y]['uuid'] = "e5f6a7b8-c9d0-1234-efab-345678901234";
	$apps[$x]['menu'][$y]['parent_uuid'] = "b4750c3f-2a86-b00d-b7d0-345c14eca286"; //applications menu
	$apps[$x]['menu'][$y]['category'] = "internal";
	$apps[$x]['menu'][$y]['icon'] = "fa-solid fa-phone";
	$apps[$x]['menu'][$y]['path'] = "/app/web_phone2/webrtc_phone.php";
	$apps[$x]['menu'][$y]['order'] = "";
	$apps[$x]['menu'][$y]['groups'][] = "superadmin";
	$apps[$x]['menu'][$y]['groups'][] = "admin";
	$apps[$x]['menu'][$y]['groups'][] = "user";
	$y++;

	$apps[$x]['menu'][$y]['title']['en-us'] = "Click-to-Dial Setup";
	$apps[$x]['menu'][$y]['uuid'] = "f6a7b8c9-d0e1-2345-fabc-456789012345";
	$apps[$x]['menu'][$y]['parent_uuid'] = "b4750c3f-2a86-b00d-b7d0-345c14eca286"; //applications menu
	$apps[$x]['menu'][$y]['category'] = "internal";
	$apps[$x]['menu'][$y]['icon'] = "fa-solid fa-computer-mouse";
	$apps[$x]['menu'][$y]['path'] = "/app/web_phone2/click_to_dial/click_to_dial_setup.php";
	$apps[$x]['menu'][$y]['order'] = "";
	$apps[$x]['menu'][$y]['groups'][] = "superadmin";
	$apps[$x]['menu'][$y]['groups'][] = "admin";
	$y++;

	$apps[$x]['menu'][$y]['title']['en-us'] = "CRM Integration";
	$apps[$x]['menu'][$y]['uuid'] = "a7b8c9d0-e1f2-3456-abcd-567890123457";
	$apps[$x]['menu'][$y]['parent_uuid'] = "b4750c3f-2a86-b00d-b7d0-345c14eca286"; //applications menu
	$apps[$x]['menu'][$y]['category'] = "internal";
	$apps[$x]['menu'][$y]['icon'] = "fa-solid fa-handshake";
	$apps[$x]['menu'][$y]['path'] = "/app/web_phone2/crm_settings.php";
	$apps[$x]['menu'][$y]['order'] = "";
	$apps[$x]['menu'][$y]['groups'][] = "superadmin";
	$apps[$x]['menu'][$y]['groups'][] = "admin";

?>
