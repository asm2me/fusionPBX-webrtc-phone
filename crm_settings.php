<?php

//includes
require_once dirname(__DIR__, 2) . "/resources/require.php";
require_once "resources/check_auth.php";

//check permission
if (!permission_exists('crm_settings_view')) {
	echo "access denied";
	exit;
}

//set variables
$domain_uuid = $_SESSION['domain_uuid'];
$domain_name = $_SESSION['domain_name'];

//handle form submission
if ($_SERVER['REQUEST_METHOD'] === 'POST' && permission_exists('crm_settings_edit')) {
	//validate token
	if (!isset($_POST['token']) || !isset($_SESSION['token']) || $_POST['token'] !== $_SESSION['token']) {
		echo "access denied";
		exit;
	}

	$crm_fields = [
		'crm_url' => ['type' => 'text', 'value' => $_POST['crm_url'] ?? ''],
		'crm_method' => ['type' => 'text', 'value' => strtoupper($_POST['crm_method'] ?? 'GET')],
		'crm_login_url' => ['type' => 'text', 'value' => $_POST['crm_login_url'] ?? ''],
		'crm_auto_login_url' => ['type' => 'text', 'value' => $_POST['crm_auto_login_url'] ?? ''],
		'crm_agent_login_url' => ['type' => 'text', 'value' => $_POST['crm_agent_login_url'] ?? ''],
		'crm_agent_logout_url' => ['type' => 'text', 'value' => $_POST['crm_agent_logout_url'] ?? ''],
	];

	//delete existing domain settings for webrtc_phone CRM
	$sql = "DELETE FROM v_domain_settings WHERE domain_uuid = :domain_uuid AND default_setting_category = 'webrtc_phone' AND default_setting_subcategory IN ('crm_url', 'crm_method', 'crm_login_url', 'crm_auto_login_url', 'crm_agent_login_url', 'crm_agent_logout_url') ";
	$parameters['domain_uuid'] = $domain_uuid;
	$database = new database;
	$database->execute($sql, $parameters);
	unset($sql, $parameters);

	//insert new values
	$y = 0;
	foreach ($crm_fields as $subcategory => $field) {
		$array['domain_settings'][$y]['domain_setting_uuid'] = uuid();
		$array['domain_settings'][$y]['domain_uuid'] = $domain_uuid;
		$array['domain_settings'][$y]['domain_setting_category'] = 'webrtc_phone';
		$array['domain_settings'][$y]['domain_setting_subcategory'] = $subcategory;
		$array['domain_settings'][$y]['domain_setting_name'] = $field['type'];
		$array['domain_settings'][$y]['domain_setting_value'] = $field['value'];
		$array['domain_settings'][$y]['domain_setting_enabled'] = 'true';
		$array['domain_settings'][$y]['domain_setting_description'] = '';
		$y++;
	}

	$p = new permissions;
	$p->add("domain_setting_add", "temp");
	$p->add("domain_setting_edit", "temp");

	$database = new database;
	$database->app_name = "webrtc_phone";
	$database->app_uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
	$database->save($array);
	unset($array);

	$p->delete("domain_setting_add", "temp");
	$p->delete("domain_setting_edit", "temp");

	//update session
	$_SESSION['webrtc_phone']['crm_url']['text'] = $crm_fields['crm_url']['value'];
	$_SESSION['webrtc_phone']['crm_method']['text'] = $crm_fields['crm_method']['value'];
	$_SESSION['webrtc_phone']['crm_login_url']['text'] = $crm_fields['crm_login_url']['value'];
	$_SESSION['webrtc_phone']['crm_auto_login_url']['text'] = $crm_fields['crm_auto_login_url']['value'];
	$_SESSION['webrtc_phone']['crm_agent_login_url']['text'] = $crm_fields['crm_agent_login_url']['value'];
	$_SESSION['webrtc_phone']['crm_agent_logout_url']['text'] = $crm_fields['crm_agent_logout_url']['value'];

	$_SESSION['message'] = "CRM settings saved.";
	header("Location: crm_settings.php");
	exit;
}

//load current values (domain settings override default settings via session)
$crm_url = '';
$crm_method = 'GET';
$crm_login_url = '';
$crm_auto_login_url = '';
$crm_agent_login_url = '';
$crm_agent_logout_url = '';

//try domain settings first
$sql = "SELECT default_setting_subcategory, default_setting_value FROM v_domain_settings ";
$sql .= "WHERE domain_uuid = :domain_uuid AND default_setting_category = 'webrtc_phone' ";
$sql .= "AND default_setting_subcategory IN ('crm_url', 'crm_method', 'crm_login_url', 'crm_auto_login_url', 'crm_agent_login_url', 'crm_agent_logout_url') ";
$sql .= "AND domain_setting_enabled = 'true' ";
$parameters['domain_uuid'] = $domain_uuid;
$database = new database;
$rows = $database->select($sql, $parameters, 'all');
unset($sql, $parameters);

$has_domain_settings = false;
if (is_array($rows) && count($rows) > 0) {
	$has_domain_settings = true;
	foreach ($rows as $row) {
		switch ($row['default_setting_subcategory']) {
			case 'crm_url': $crm_url = $row['default_setting_value']; break;
			case 'crm_method': $crm_method = $row['default_setting_value']; break;
			case 'crm_login_url': $crm_login_url = $row['default_setting_value']; break;
			case 'crm_auto_login_url': $crm_auto_login_url = $row['default_setting_value']; break;
			case 'crm_agent_login_url': $crm_agent_login_url = $row['default_setting_value']; break;
			case 'crm_agent_logout_url': $crm_agent_logout_url = $row['default_setting_value']; break;
		}
	}
}

//fall back to session (which merges default + domain settings)
if (!$has_domain_settings) {
	$crm_url = $_SESSION['webrtc_phone']['crm_url']['text'] ?? '';
	$crm_method = $_SESSION['webrtc_phone']['crm_method']['text'] ?? 'GET';
	$crm_login_url = $_SESSION['webrtc_phone']['crm_login_url']['text'] ?? '';
	$crm_auto_login_url = $_SESSION['webrtc_phone']['crm_auto_login_url']['text'] ?? '';
	$crm_agent_login_url = $_SESSION['webrtc_phone']['crm_agent_login_url']['text'] ?? '';
	$crm_agent_logout_url = $_SESSION['webrtc_phone']['crm_agent_logout_url']['text'] ?? '';
}

//generate token
$token = md5(uniqid(rand(), true));
$_SESSION['token'] = $token;

//include header
$document['title'] = "CRM Integration Settings";
require_once "resources/header.php";

?>

<div class="action_bar" id="action_bar">
	<div class="heading"><b>CRM Integration Settings</b></div>
	<div class="actions">
		<?php if (permission_exists('crm_settings_edit')) { ?>
		<button type="button" class="btn btn-primary" onclick="document.getElementById('crm_form').submit();">
			<span class="fas fa-save"></span>&nbsp;Save
		</button>
		<?php } ?>
	</div>
	<div style="clear: both;"></div>
</div>

<?php
if (isset($_SESSION['message'])) {
	echo "<div class='alert alert-success' style='margin:10px 0'>".$_SESSION['message']."</div>";
	unset($_SESSION['message']);
}
?>

<form id="crm_form" method="post">
<input type="hidden" name="token" value="<?php echo $token; ?>">

<table class="table" width="100%" border="0" cellpadding="0" cellspacing="0">
	<tr>
		<td class="vncell" width="30%">Domain</td>
		<td class="vtable"><?php echo escape($domain_name); ?></td>
	</tr>
	<tr>
		<td class="vncell">CRM Webhook URL</td>
		<td class="vtable">
			<input type="text" class="formfld" name="crm_url" value="<?php echo escape($crm_url); ?>" style="width:100%;max-width:600px">
			<br><span class="description">
				URL called on call events. Placeholders:<br>
				<code>{event}</code> - new_call, dial_out, answered, hangup<br>
				<code>{caller_id}</code> - Caller number &nbsp;
				<code>{caller_name}</code> - Caller name<br>
				<code>{destination}</code> - Destination number &nbsp;
				<code>{direction}</code> - inbound/outbound<br>
				<code>{duration}</code> - Call duration (seconds) &nbsp;
				<code>{extension}</code> - Local extension<br>
				<code>{call_id}</code> - SIP Call-ID &nbsp;
				<code>{timestamp}</code> - ISO timestamp<br><br>
				Example: <code>https://crm.example.com/api/call?event={event}&from={caller_id}&to={destination}</code>
			</span>
		</td>
	</tr>
	<tr>
		<td class="vncell">Webhook Method</td>
		<td class="vtable">
			<select class="formfld" name="crm_method">
				<option value="GET" <?php echo ($crm_method === 'GET') ? 'selected' : ''; ?>>GET</option>
				<option value="POST" <?php echo ($crm_method === 'POST') ? 'selected' : ''; ?>>POST</option>
			</select>
			<br><span class="description">POST sends JSON body with all fields. GET uses URL placeholders only.</span>
		</td>
	</tr>
	<tr>
		<td class="vncell">CRM Screen-Pop URL</td>
		<td class="vtable">
			<input type="text" class="formfld" name="crm_login_url" value="<?php echo escape($crm_login_url); ?>" style="width:100%;max-width:600px">
			<br><span class="description">
				Opens in a new browser tab on incoming call. Use to screen-pop customer records.<br>
				Same placeholders as above.<br><br>
				Example: <code>https://crm.example.com/contact?phone={caller_id}</code>
			</span>
		</td>
	</tr>
	<tr>
		<td class="vncell" colspan="2" style="background:#e8e8e8;font-weight:bold;padding:8px">Call Center Agent Events</td>
	</tr>
	<tr>
		<td class="vncell">Agent Login URL</td>
		<td class="vtable">
			<input type="text" class="formfld" name="crm_agent_login_url" value="<?php echo escape($crm_agent_login_url); ?>" style="width:100%;max-width:600px">
			<br><span class="description">
				Webhook fired when agent logs into the call center queue.<br>
				Placeholders: <code>{extension}</code> <code>{timestamp}</code> <code>{domain}</code><br><br>
				Example: <code>https://crm.example.com/api/agent/login?ext={extension}</code>
			</span>
		</td>
	</tr>
	<tr>
		<td class="vncell">Agent Logout URL</td>
		<td class="vtable">
			<input type="text" class="formfld" name="crm_agent_logout_url" value="<?php echo escape($crm_agent_logout_url); ?>" style="width:100%;max-width:600px">
			<br><span class="description">
				Webhook fired when agent logs out of the call center queue.<br>
				Placeholders: <code>{extension}</code> <code>{timestamp}</code> <code>{domain}</code><br><br>
				Example: <code>https://crm.example.com/api/agent/logout?ext={extension}</code>
			</span>
		</td>
	</tr>
	<tr>
		<td class="vncell" colspan="2" style="background:#e8e8e8;font-weight:bold;padding:8px">Browser Actions</td>
	</tr>
	<tr>
		<td class="vncell">CRM Auto-Login URL</td>
		<td class="vtable">
			<input type="text" class="formfld" name="crm_auto_login_url" value="<?php echo escape($crm_auto_login_url); ?>" style="width:100%;max-width:600px">
			<br><span class="description">
				Opens automatically in a new tab when the agent logs into FusionPBX.<br>
				Use to auto-login agents to the CRM at the start of their shift.<br>
				Placeholders: <code>{extension}</code> <code>{timestamp}</code><br><br>
				Example: <code>https://crm.example.com/agent/login?ext={extension}</code>
			</span>
		</td>
	</tr>
</table>

</form>

<?php
require_once "resources/footer.php";
?>
