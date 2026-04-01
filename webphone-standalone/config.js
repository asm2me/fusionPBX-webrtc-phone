/*
	Webphone Standalone - Configuration File
	==========================================
	Edit this file to set server and account defaults.
	Users will only be prompted for Extension and Password if not set here.

	Deploy this file alongside index.html on your web server.
*/

var OURFONE_CONFIG = {

	// --- SIP Server (required) ---
	domain: '',                          // SIP server hostname, e.g. 'pbx.example.com'
	wss_port: '7443',                    // WebSocket Secure port (use '443' for wss://domain/wss)

	// --- Default Extension (optional) ---
	// If set, user won't be prompted for credentials — auto-connects on load.
	// Leave empty to show a login form.
	extensions: [
		// {
		//     extension: '1001',
		//     password: 'secret',
		//     caller_id_name: 'John Doe',
		//     caller_id_number: '1001',
		//     description: 'Main Desk'
		// }
	],

	// --- STUN / TURN ---
	stun_server: 'stun:stun.l.google.com:19302',
	turn_server: '',                     // e.g. 'turn:turn.example.com:3478'
	turn_username: '',
	turn_password: '',

	// --- CRM Integration (optional) ---
	// Placeholders: {event}, {caller_id}, {caller_name}, {destination},
	//               {direction}, {duration}, {extension}, {call_id}, {timestamp}
	crm_url: '',                         // Webhook URL, e.g. 'https://crm.example.com/api/call?event={event}&from={caller_id}'
	crm_method: 'GET',                   // 'GET' or 'POST'
	crm_login_url: '',                   // Screen-pop URL on incoming call
	crm_auto_login_url: '',              // Opens once on page load
	crm_agent_login_url: '',             // Agent queue login webhook
	crm_agent_logout_url: ''             // Agent queue logout webhook

};
