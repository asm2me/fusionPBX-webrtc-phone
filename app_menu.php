<?php

	$y = 0;
	$apps[$x]['menu'][$y]['title']['en-us'] = "WebRTC Phone";
	$apps[$x]['menu'][$y]['uuid'] = "e5f6a7b8-c9d0-1234-efab-345678901234";
	$apps[$x]['menu'][$y]['parent_uuid'] = "587f2da1-2df0-4ee0-b10a-6677c5e89e61"; //applications menu
	$apps[$x]['menu'][$y]['category'] = "internal";
	$apps[$x]['menu'][$y]['icon'] = "";
	$apps[$x]['menu'][$y]['path'] = "/app/web_phone2/webrtc_phone.php";
	$apps[$x]['menu'][$y]['order'] = "";
	$apps[$x]['menu'][$y]['groups'][] = "superadmin";
	$apps[$x]['menu'][$y]['groups'][] = "admin";
	$apps[$x]['menu'][$y]['groups'][] = "user";
	$y++;

	$apps[$x]['menu'][$y]['title']['en-us'] = "Click-to-Dial Setup";
	$apps[$x]['menu'][$y]['uuid'] = "f6a7b8c9-d0e1-2345-fabc-456789012345";
	$apps[$x]['menu'][$y]['parent_uuid'] = "587f2da1-2df0-4ee0-b10a-6677c5e89e61"; //applications menu
	$apps[$x]['menu'][$y]['category'] = "internal";
	$apps[$x]['menu'][$y]['icon'] = "";
	$apps[$x]['menu'][$y]['path'] = "/app/web_phone2/click_to_dial/click_to_dial_setup.php";
	$apps[$x]['menu'][$y]['order'] = "";
	$apps[$x]['menu'][$y]['groups'][] = "superadmin";
	$apps[$x]['menu'][$y]['groups'][] = "admin";

?>
