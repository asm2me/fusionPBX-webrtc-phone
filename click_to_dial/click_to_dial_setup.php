<?php

/*
	FusionPBX
	Version: MPL 1.1

	Click-to-Dial Setup Page
	Admin page for creating/managing API tokens and generating embed code.
*/

//includes
$document_root = dirname(__DIR__, 2);
require_once $document_root."/resources/require.php";
require_once $document_root."/resources/check_auth.php";

//check permissions
if (!permission_exists('click_to_dial_view')) {
	echo "access denied";
	exit;
}

//get domain info
$domain_uuid = $_SESSION['domain_uuid'] ?? '';
$domain_name = $_SESSION['domain_name'] ?? '';

if (empty($domain_uuid)) {
	echo "session invalid";
	exit;
}

//handle form actions
$action = $_POST['action'] ?? '';
$message = '';
$message_type = '';

//create token
if ($action === 'create' && permission_exists('click_to_dial_edit')) {
	$extension_uuid = $_POST['extension_uuid'] ?? '';
	$allowed_origins = trim($_POST['allowed_origins'] ?? '');
	$destination_number = trim($_POST['destination_number'] ?? '');
	$departments = trim($_POST['departments'] ?? '');
	$button_color = $_POST['button_color'] ?? '#1a73e8';
	$button_position = $_POST['button_position'] ?? 'bottom-right';
	$button_label = $_POST['button_label'] ?? '';
	$token_name = trim($_POST['token_name'] ?? '');

	if (empty($extension_uuid)) {
		$message = 'Please select a SIP extension for registration.';
		$message_type = 'error';
	} elseif (empty($destination_number)) {
		$message = 'Please select a destination number.';
		$message_type = 'error';
	} else {
		//generate a secure random token
		$api_token = bin2hex(random_bytes(32));
		$token_uuid = uuid();

		$sql = "INSERT INTO v_click_to_dial_tokens ";
		$sql .= "(click_to_dial_token_uuid, domain_uuid, extension_uuid, api_token, token_name, ";
		$sql .= "allowed_origins, destination_number, departments, button_color, button_position, button_label, token_enabled, ";
		$sql .= "insert_date, insert_user) ";
		$sql .= "VALUES (:uuid, :domain_uuid, :extension_uuid, :api_token, :token_name, ";
		$sql .= ":allowed_origins, :destination_number, :departments, :button_color, :button_position, :button_label, 'true', ";
		$sql .= "now(), :user_uuid) ";

		$parameters = [
			'uuid' => $token_uuid,
			'domain_uuid' => $domain_uuid,
			'extension_uuid' => $extension_uuid,
			'api_token' => $api_token,
			'token_name' => $token_name,
			'allowed_origins' => $allowed_origins,
			'destination_number' => $destination_number,
			'departments' => $departments,
			'button_color' => $button_color,
			'button_position' => $button_position,
			'button_label' => $button_label,
			'user_uuid' => $_SESSION['user_uuid']
		];

		$database = new database;
		$database->execute($sql, $parameters);
		unset($sql, $parameters);

		$message = 'Token created successfully.';
		$message_type = 'success';
	}
}

//delete token
if ($action === 'delete' && permission_exists('click_to_dial_delete')) {
	$delete_uuid = $_POST['token_uuid'] ?? '';
	if (!empty($delete_uuid)) {
		$sql = "DELETE FROM v_click_to_dial_tokens ";
		$sql .= "WHERE click_to_dial_token_uuid = :uuid ";
		$sql .= "AND domain_uuid = :domain_uuid ";
		$parameters = ['uuid' => $delete_uuid, 'domain_uuid' => $domain_uuid];
		$database = new database;
		$database->execute($sql, $parameters);
		unset($sql, $parameters);
		$message = 'Token deleted.';
		$message_type = 'success';
	}
}

//toggle token enabled/disabled
if ($action === 'toggle' && permission_exists('click_to_dial_edit')) {
	$toggle_uuid = $_POST['token_uuid'] ?? '';
	$toggle_enabled = $_POST['token_enabled'] === 'true' ? 'false' : 'true';
	if (!empty($toggle_uuid)) {
		$sql = "UPDATE v_click_to_dial_tokens SET token_enabled = :enabled ";
		$sql .= "WHERE click_to_dial_token_uuid = :uuid AND domain_uuid = :domain_uuid ";
		$parameters = ['enabled' => $toggle_enabled, 'uuid' => $toggle_uuid, 'domain_uuid' => $domain_uuid];
		$database = new database;
		$database->execute($sql, $parameters);
		unset($sql, $parameters);
	}
}

//get all tokens for this domain
$sql = "SELECT t.*, e.extension, e.effective_caller_id_name, e.description AS ext_description ";
$sql .= "FROM v_click_to_dial_tokens AS t ";
$sql .= "JOIN v_extensions AS e ON t.extension_uuid = e.extension_uuid ";
$sql .= "WHERE t.domain_uuid = :domain_uuid ";
$sql .= "ORDER BY t.insert_date DESC ";
$parameters = ['domain_uuid' => $domain_uuid];
$database = new database;
$tokens = $database->select($sql, $parameters, 'all');
unset($sql, $parameters);
if (!is_array($tokens)) $tokens = [];

//get available extensions for the SIP registration dropdown
$sql = "SELECT e.extension_uuid, e.extension, e.effective_caller_id_name, e.description ";
$sql .= "FROM v_extensions AS e ";
$sql .= "WHERE e.domain_uuid = :domain_uuid ";
$sql .= "AND e.enabled = 'true' ";
$sql .= "ORDER BY e.extension ASC ";
$parameters = ['domain_uuid' => $domain_uuid];
$extensions = $database->select($sql, $parameters, 'all');
unset($sql, $parameters);
if (!is_array($extensions)) $extensions = [];

//get destinations: extensions, ring groups, call queues, IVR menus
$destinations = [];

//extensions
foreach ($extensions as $ext) {
	$label = 'Ext ' . $ext['extension'];
	if (!empty($ext['effective_caller_id_name'])) $label .= ' - ' . $ext['effective_caller_id_name'];
	if (!empty($ext['description'])) $label .= ' (' . $ext['description'] . ')';
	$destinations[] = ['number' => $ext['extension'], 'label' => $label, 'type' => 'Extension'];
}

//ring groups
$sql = "SELECT ring_group_extension, ring_group_name FROM v_ring_groups ";
$sql .= "WHERE domain_uuid = :domain_uuid AND ring_group_enabled = 'true' ";
$sql .= "ORDER BY ring_group_extension ASC ";
$parameters = ['domain_uuid' => $domain_uuid];
$ring_groups = $database->select($sql, $parameters, 'all');
unset($sql, $parameters);
if (is_array($ring_groups)) {
	foreach ($ring_groups as $rg) {
		$destinations[] = [
			'number' => $rg['ring_group_extension'],
			'label' => 'Ring Group ' . $rg['ring_group_extension'] . ' - ' . $rg['ring_group_name'],
			'type' => 'Ring Group'
		];
	}
}

//call center queues
$sql = "SELECT queue_extension, queue_name FROM v_call_center_queues ";
$sql .= "WHERE domain_uuid = :domain_uuid ";
$sql .= "ORDER BY queue_extension ASC ";
$parameters = ['domain_uuid' => $domain_uuid];
$queues = $database->select($sql, $parameters, 'all');
unset($sql, $parameters);
if (is_array($queues)) {
	foreach ($queues as $q) {
		$destinations[] = [
			'number' => $q['queue_extension'],
			'label' => 'Queue ' . $q['queue_extension'] . ' - ' . $q['queue_name'],
			'type' => 'Call Queue'
		];
	}
}

//IVR menus
$sql = "SELECT ivr_menu_extension, ivr_menu_name FROM v_ivr_menus ";
$sql .= "WHERE domain_uuid = :domain_uuid AND ivr_menu_enabled = 'true' ";
$sql .= "ORDER BY ivr_menu_extension ASC ";
$parameters = ['domain_uuid' => $domain_uuid];
$ivrs = $database->select($sql, $parameters, 'all');
unset($sql, $parameters);
if (is_array($ivrs)) {
	foreach ($ivrs as $ivr) {
		$destinations[] = [
			'number' => $ivr['ivr_menu_extension'],
			'label' => 'IVR ' . $ivr['ivr_menu_extension'] . ' - ' . $ivr['ivr_menu_name'],
			'type' => 'IVR Menu'
		];
	}
}

//determine the base URL for the embed script
$scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$base_url = $scheme . '://' . $domain_name;

//page output
require_once $document_root."/resources/header.php";

?>

<style>
.ctd-setup { max-width: 960px; margin: 0 auto; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
.ctd-setup h2 { margin: 0 0 20px; font-size: 22px; color: #333; }
.ctd-setup h3 { margin: 24px 0 12px; font-size: 16px; color: #555; }
.ctd-card { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
.ctd-form-row { display: flex; gap: 12px; margin-bottom: 12px; align-items: flex-end; flex-wrap: wrap; }
.ctd-form-group { display: flex; flex-direction: column; gap: 4px; }
.ctd-form-group label { font-size: 13px; font-weight: 600; color: #555; }
.ctd-form-group input, .ctd-form-group select, .ctd-form-group textarea { padding: 8px 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px; }
.ctd-form-group textarea { min-height: 60px; font-family: monospace; font-size: 12px; resize: vertical; }
.ctd-form-group small { color: #888; font-weight: 400; }
.ctd-btn { padding: 8px 16px; border: none; border-radius: 4px; font-size: 14px; cursor: pointer; font-weight: 500; }
.ctd-btn-primary { background: #1a73e8; color: #fff; }
.ctd-btn-primary:hover { background: #1557b0; }
.ctd-btn-danger { background: #e53935; color: #fff; }
.ctd-btn-danger:hover { background: #c62828; }
.ctd-btn-sm { padding: 4px 10px; font-size: 12px; }
.ctd-msg { padding: 10px 14px; border-radius: 4px; margin-bottom: 16px; font-size: 14px; }
.ctd-msg-success { background: #e8f5e9; color: #2e7d32; border: 1px solid #a5d6a7; }
.ctd-msg-error { background: #ffebee; color: #c62828; border: 1px solid #ef9a9a; }
.ctd-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.ctd-table th { text-align: left; padding: 8px 10px; border-bottom: 2px solid #ddd; font-weight: 600; color: #555; }
.ctd-table td { padding: 8px 10px; border-bottom: 1px solid #eee; vertical-align: top; }
.ctd-table tr:hover td { background: #f5f5f5; }
.ctd-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
.ctd-badge-active { background: #e8f5e9; color: #2e7d32; }
.ctd-badge-disabled { background: #ffebee; color: #c62828; }
.ctd-embed-box { background: #f5f5f5; border: 1px solid #ddd; border-radius: 4px; padding: 12px; margin-top: 8px; position: relative; }
.ctd-embed-code { font-family: monospace; font-size: 12px; white-space: pre-wrap; word-break: break-all; color: #333; margin: 0; }
.ctd-copy-btn { position: absolute; top: 8px; right: 8px; padding: 4px 10px; background: #1a73e8; color: #fff; border: none; border-radius: 4px; font-size: 11px; cursor: pointer; }
.ctd-copy-btn:hover { background: #1557b0; }
.ctd-actions { display: flex; gap: 6px; }
.ctd-color-preview { width: 24px; height: 24px; border-radius: 4px; border: 1px solid #ccc; display: inline-block; vertical-align: middle; }
.ctd-section-divider { border-top: 1px solid #eee; margin: 16px 0; padding-top: 16px; }
.ctd-section-label { font-size: 13px; font-weight: 700; color: #1a73e8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; }

@media (prefers-color-scheme: dark) {
	.ctd-setup h2 { color: #e0e0e0; }
	.ctd-setup h3 { color: #bbb; }
	.ctd-card { background: #1e1e1e; border-color: #333; }
	.ctd-form-group label { color: #bbb; }
	.ctd-form-group input, .ctd-form-group select, .ctd-form-group textarea { background: #2a2a2a; border-color: #444; color: #e0e0e0; }
	.ctd-table th { border-color: #444; color: #bbb; }
	.ctd-table td { border-color: #333; }
	.ctd-table tr:hover td { background: #252525; }
	.ctd-embed-box { background: #1a1a1a; border-color: #333; }
	.ctd-embed-code { color: #e0e0e0; }
	.ctd-section-divider { border-color: #333; }
}
</style>

<div class="ctd-setup">
	<h2>Click-to-Dial Setup</h2>
	<p style="color:#666; margin-bottom:20px;">Generate embeddable JavaScript widgets for third-party websites. Visitors fill in their details and the widget calls your PBX destination with caller ID set from the visitor's info.</p>

	<?php if (!empty($message)): ?>
		<div class="ctd-msg ctd-msg-<?php echo $message_type; ?>"><?php echo htmlspecialchars($message); ?></div>
	<?php endif; ?>

	<!-- Create New Token -->
	<?php if (permission_exists('click_to_dial_edit')): ?>
	<div class="ctd-card">
		<h3 style="margin-top:0">Create New Widget Token</h3>
		<form method="post">
			<input type="hidden" name="action" value="create">

			<!-- Call Routing Section -->
			<div class="ctd-section-label">Call Routing</div>
			<div class="ctd-form-row">
				<div class="ctd-form-group" style="flex:1">
					<label>Token Name</label>
					<input type="text" name="token_name" placeholder="e.g. Company Website" required>
				</div>
				<div class="ctd-form-group" style="flex:1">
					<label>SIP Extension <small>(used for WebRTC registration)</small></label>
					<select name="extension_uuid" required>
						<option value="">-- Select Extension --</option>
						<?php foreach ($extensions as $ext): ?>
							<option value="<?php echo htmlspecialchars($ext['extension_uuid']); ?>">
								<?php echo htmlspecialchars($ext['extension']);
									if (!empty($ext['effective_caller_id_name'])) echo ' - ' . htmlspecialchars($ext['effective_caller_id_name']);
									if (!empty($ext['description'])) echo ' (' . htmlspecialchars($ext['description']) . ')';
								?>
							</option>
						<?php endforeach; ?>
					</select>
				</div>
			</div>
			<div class="ctd-form-row">
				<div class="ctd-form-group" style="flex:1">
					<label>Destination Number <small>(where calls are routed to - queue, ring group, extension, IVR)</small></label>
					<select name="destination_number" required>
						<option value="">-- Select Destination --</option>
						<?php
							$last_type = '';
							foreach ($destinations as $dest):
								if ($dest['type'] !== $last_type):
									if ($last_type !== '') echo '</optgroup>';
									echo '<optgroup label="' . htmlspecialchars($dest['type']) . 's">';
									$last_type = $dest['type'];
								endif;
						?>
							<option value="<?php echo htmlspecialchars($dest['number']); ?>">
								<?php echo htmlspecialchars($dest['label']); ?>
							</option>
						<?php endforeach;
							if ($last_type !== '') echo '</optgroup>';
						?>
					</select>
				</div>
			</div>

			<!-- Departments Section -->
			<div class="ctd-section-divider"></div>
			<div class="ctd-section-label">Departments</div>
			<div class="ctd-form-row">
				<div class="ctd-form-group" style="flex:1">
					<label>Department List <small>(one per line - shown to visitors in the form before calling)</small></label>
					<textarea name="departments" rows="5" placeholder="Sales&#10;Support&#10;Billing&#10;Technical&#10;General Inquiry"></textarea>
				</div>
			</div>

			<!-- Security Section -->
			<div class="ctd-section-divider"></div>
			<div class="ctd-section-label">Security</div>
			<div class="ctd-form-row">
				<div class="ctd-form-group" style="flex:1">
					<label>Allowed Origins <small>(one per line, * for any, leave empty to allow all)</small></label>
					<textarea name="allowed_origins" placeholder="https://www.example.com&#10;https://app.example.com"></textarea>
				</div>
			</div>

			<!-- Appearance Section -->
			<div class="ctd-section-divider"></div>
			<div class="ctd-section-label">Appearance</div>
			<div class="ctd-form-row">
				<div class="ctd-form-group">
					<label>Button Color</label>
					<input type="color" name="button_color" value="#1a73e8" style="width:60px;height:36px;padding:2px;">
				</div>
				<div class="ctd-form-group" style="flex:1">
					<label>Button Position</label>
					<select name="button_position">
						<option value="bottom-right">Bottom Right</option>
						<option value="bottom-left">Bottom Left</option>
						<option value="top-right">Top Right</option>
						<option value="top-left">Top Left</option>
					</select>
				</div>
				<div class="ctd-form-group" style="flex:1">
					<label>Button Label <small>(optional, shows next to icon)</small></label>
					<input type="text" name="button_label" placeholder="e.g. Call Us">
				</div>
			</div>

			<div style="margin-top:12px;">
				<button type="submit" class="ctd-btn ctd-btn-primary">Generate Token &amp; Embed Code</button>
			</div>
		</form>
	</div>
	<?php endif; ?>

	<!-- Existing Tokens -->
	<div class="ctd-card">
		<h3 style="margin-top:0">Active Widget Tokens</h3>
		<?php if (empty($tokens)): ?>
			<p style="color:#888; font-size:14px;">No tokens created yet. Create one above to get started.</p>
		<?php else: ?>
			<table class="ctd-table">
				<thead>
					<tr>
						<th>Name</th>
						<th>Extension</th>
						<th>Destination</th>
						<th>Departments</th>
						<th>Status</th>
						<th>Embed Code</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody>
				<?php foreach ($tokens as $tok): ?>
					<tr>
						<td>
							<strong><?php echo htmlspecialchars($tok['token_name'] ?? 'Unnamed'); ?></strong>
							<br><span class="ctd-color-preview" style="background:<?php echo htmlspecialchars($tok['button_color'] ?? '#1a73e8'); ?>"></span>
							<small><?php echo htmlspecialchars($tok['button_position'] ?? 'bottom-right'); ?></small>
						</td>
						<td>
							<?php echo htmlspecialchars($tok['extension']);
								if (!empty($tok['effective_caller_id_name'])) echo '<br><small>' . htmlspecialchars($tok['effective_caller_id_name']) . '</small>';
							?>
						</td>
						<td>
							<strong><?php echo htmlspecialchars($tok['destination_number'] ?? 'N/A'); ?></strong>
						</td>
						<td>
							<?php
								$depts = trim($tok['departments'] ?? '');
								if ($depts) {
									$dept_list = array_filter(array_map('trim', explode("\n", $depts)));
									echo '<small>' . htmlspecialchars(implode(', ', $dept_list)) . '</small>';
								} else {
									echo '<small style="color:#888">None</small>';
								}
							?>
						</td>
						<td>
							<span class="ctd-badge <?php echo $tok['token_enabled'] === 'true' ? 'ctd-badge-active' : 'ctd-badge-disabled'; ?>">
								<?php echo $tok['token_enabled'] === 'true' ? 'Active' : 'Disabled'; ?>
							</span>
						</td>
						<td>
							<?php
								$embed_code = '<script src="' . $base_url . '/app/webrtc_phone/click_to_dial/resources/js/click_to_dial.js"'
									. ' data-ctd-server="' . htmlspecialchars($base_url) . '"'
									. ' data-ctd-token="' . htmlspecialchars($tok['api_token']) . '"'
									. '></script>';
							?>
							<div class="ctd-embed-box">
								<button class="ctd-copy-btn" onclick="copyEmbed(this)" data-code="<?php echo htmlspecialchars($embed_code); ?>">Copy</button>
								<pre class="ctd-embed-code"><?php echo htmlspecialchars($embed_code); ?></pre>
							</div>
						</td>
						<td>
							<div class="ctd-actions">
								<?php if (permission_exists('click_to_dial_edit')): ?>
								<form method="post" style="display:inline">
									<input type="hidden" name="action" value="toggle">
									<input type="hidden" name="token_uuid" value="<?php echo htmlspecialchars($tok['click_to_dial_token_uuid']); ?>">
									<input type="hidden" name="token_enabled" value="<?php echo htmlspecialchars($tok['token_enabled']); ?>">
									<button type="submit" class="ctd-btn ctd-btn-sm" title="<?php echo $tok['token_enabled'] === 'true' ? 'Disable' : 'Enable'; ?>">
										<?php echo $tok['token_enabled'] === 'true' ? 'Disable' : 'Enable'; ?>
									</button>
								</form>
								<?php endif; ?>
								<?php if (permission_exists('click_to_dial_delete')): ?>
								<form method="post" style="display:inline" onsubmit="return confirm('Delete this token? Any website using it will stop working.')">
									<input type="hidden" name="action" value="delete">
									<input type="hidden" name="token_uuid" value="<?php echo htmlspecialchars($tok['click_to_dial_token_uuid']); ?>">
									<button type="submit" class="ctd-btn ctd-btn-sm ctd-btn-danger">Delete</button>
								</form>
								<?php endif; ?>
							</div>
						</td>
					</tr>
				<?php endforeach; ?>
				</tbody>
			</table>
		<?php endif; ?>
	</div>

	<!-- Usage Instructions -->
	<div class="ctd-card">
		<h3 style="margin-top:0">How It Works</h3>
		<ol style="font-size:14px; line-height:1.8; color:#555;">
			<li>Create a token above: select a SIP extension (for WebRTC registration), a destination number (where calls go), and configure departments.</li>
			<li>Copy the generated embed code snippet.</li>
			<li>Paste it into your website's HTML, just before the closing <code>&lt;/body&gt;</code> tag.</li>
			<li>When a visitor clicks the phone button, they fill in their <strong>Name</strong>, <strong>Phone Number</strong>, and <strong>Department</strong>.</li>
			<li>The call is placed to your destination number with the visitor's phone number as <strong>Caller ID number</strong> and their name + department as <strong>Caller ID name</strong>.</li>
		</ol>

		<h3>Caller ID Behavior</h3>
		<p style="font-size:14px; color:#555;">
			The visitor's info is passed to FreeSWITCH via SIP headers:<br>
			<strong>Caller ID Name:</strong> <code>Visitor Name [Department]</code><br>
			<strong>Caller ID Number:</strong> <code>Visitor's Phone Number</code><br>
			These are set as <code>X-CTD-Caller-Name</code>, <code>X-CTD-Caller-Number</code>, and <code>X-CTD-Department</code> SIP headers.
			Configure your dialplan to use these for queue/caller ID display.
		</p>

		<h3>Click-to-Dial Links</h3>
		<p style="font-size:14px; color:#555;">You can also trigger the call form programmatically:</p>
		<div class="ctd-embed-box">
			<pre class="ctd-embed-code">&lt;!-- Button that opens the call form --&gt;
&lt;button data-ctd-dial&gt;Call Us Now&lt;/button&gt;

&lt;!-- JavaScript API --&gt;
&lt;script&gt;
  // Open the call form
  ClickToDial.open();

  // Check if registered
  if (ClickToDial.isRegistered()) { ... }
&lt;/script&gt;</pre>
		</div>
	</div>
</div>

<script>
function copyEmbed(btn) {
	var code = btn.getAttribute('data-code');
	if (navigator.clipboard) {
		navigator.clipboard.writeText(code).then(function() {
			btn.textContent = 'Copied!';
			setTimeout(function() { btn.textContent = 'Copy'; }, 2000);
		});
	} else {
		var ta = document.createElement('textarea');
		ta.value = code;
		document.body.appendChild(ta);
		ta.select();
		document.execCommand('copy');
		document.body.removeChild(ta);
		btn.textContent = 'Copied!';
		setTimeout(function() { btn.textContent = 'Copy'; }, 2000);
	}
}
</script>

<?php

require_once $document_root."/resources/footer.php";

?>
