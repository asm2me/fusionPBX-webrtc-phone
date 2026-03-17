/*
	FusionPBX Click-to-Dial Widget
	Embeddable JavaScript plugin for third-party websites.
	Self-contained: includes CSS, JsSIP loader, SIP registration, and minimal phone UI.

	Flow:
	1. Visitor clicks the floating phone button
	2. Visitor fills in: Name, Phone Number, Department
	3. Widget calls the configured destination number
	4. Visitor's info is passed as Caller ID via SIP headers

	Usage:
	<script src="https://your-pbx.com/app/webrtc_phone/click_to_dial/resources/js/click_to_dial.js"
		data-ctd-server="https://your-pbx.com"
		data-ctd-token="YOUR_API_TOKEN">
	</script>
*/

(function () {
	'use strict';

	// --- Prevent double-init ---
	if (window.__CTD_LOADED) return;
	window.__CTD_LOADED = true;

	// --- Read config from script tag ---
	var scriptTag = document.currentScript || (function () {
		var scripts = document.getElementsByTagName('script');
		for (var i = scripts.length - 1; i >= 0; i--) {
			if (scripts[i].src && scripts[i].src.indexOf('click_to_dial.js') !== -1) return scripts[i];
		}
		return null;
	})();

	if (!scriptTag) { console.error('CTD: Cannot find script tag'); return; }

	var CTD_SERVER = scriptTag.getAttribute('data-ctd-server') || '';
	var CTD_TOKEN = scriptTag.getAttribute('data-ctd-token') || '';

	if (!CTD_SERVER || !CTD_TOKEN) {
		console.error('CTD: Missing data-ctd-server or data-ctd-token attributes');
		return;
	}

	// Remove trailing slash
	CTD_SERVER = CTD_SERVER.replace(/\/+$/, '');

	// --- State ---
	var state = {
		config: null,
		ua: null,
		session: null,
		registered: false,
		callState: 'idle',   // idle, ringing_out, in_call
		muted: false,
		held: false,
		callDuration: 0,
		callTimer: null,
		visible: false,
		remoteAudio: null,
		uiColor: '#1a73e8',
		position: 'bottom-right',
		buttonLabel: '',
		jssipLoaded: false,
		// Visitor info
		callerName: '',
		callerPhone: '',
		callerDepartment: '',
		formSubmitted: false,
		formError: '',
		// Config from server
		destinationNumber: '',
		departments: []
	};

	// --- Inject CSS ---
	function injectCSS() {
		var css = [
			'#ctd-container{position:fixed;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;line-height:1.4;box-sizing:border-box}',
			'#ctd-container *{box-sizing:border-box;margin:0;padding:0}',
			// Positions
			'#ctd-container.ctd-bottom-right{bottom:24px;right:24px}',
			'#ctd-container.ctd-bottom-left{bottom:24px;left:24px}',
			'#ctd-container.ctd-top-right{top:24px;right:24px}',
			'#ctd-container.ctd-top-left{top:24px;left:24px}',
			// FAB
			'#ctd-fab{display:flex;align-items:center;gap:8px;padding:0 16px;height:52px;border-radius:26px;border:none;cursor:pointer;color:#fff;font-size:14px;font-weight:600;box-shadow:0 4px 14px rgba(0,0,0,.3);transition:transform .2s,box-shadow .2s}',
			'#ctd-fab:hover{transform:scale(1.05);box-shadow:0 6px 20px rgba(0,0,0,.35)}',
			'#ctd-fab:active{transform:scale(.95)}',
			'#ctd-fab svg{width:22px;height:22px;flex-shrink:0}',
			'#ctd-fab .ctd-fab-label{white-space:nowrap}',
			'#ctd-fab.ctd-fab-icon-only{width:52px;padding:0;justify-content:center;border-radius:50%}',
			// Badge
			'.ctd-badge{position:absolute;top:-4px;right:-4px;background:#e53935;color:#fff;font-size:10px;font-weight:700;width:18px;height:18px;border-radius:50%;display:none;align-items:center;justify-content:center;animation:ctd-pulse 1.5s infinite}',
			'.ctd-badge.ctd-show{display:flex}',
			'@keyframes ctd-pulse{0%,100%{box-shadow:0 0 0 0 rgba(229,57,53,.5)}50%{box-shadow:0 0 0 8px rgba(229,57,53,0)}}',
			// Panel
			'#ctd-panel{position:absolute;width:320px;background:#fff;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.25);overflow:hidden;display:none;flex-direction:column}',
			'#ctd-panel.ctd-open{display:flex}',
			'.ctd-bottom-right #ctd-panel,.ctd-bottom-left #ctd-panel{bottom:62px}',
			'.ctd-top-right #ctd-panel,.ctd-top-left #ctd-panel{top:62px}',
			'.ctd-bottom-right #ctd-panel,.ctd-top-right #ctd-panel{right:0}',
			'.ctd-bottom-left #ctd-panel,.ctd-top-left #ctd-panel{left:0}',
			// Header
			'.ctd-header{color:#fff;padding:12px 14px;display:flex;align-items:center;gap:8px}',
			'.ctd-header-title{flex:1;font-size:14px;font-weight:600}',
			'.ctd-header-status{font-size:11px;opacity:.8;background:rgba(255,255,255,.2);padding:2px 8px;border-radius:10px}',
			'.ctd-close-btn{background:none;border:none;color:#fff;font-size:20px;cursor:pointer;padding:0 4px;line-height:1;opacity:.8}',
			'.ctd-close-btn:hover{opacity:1}',
			// Body
			'.ctd-body{padding:14px 16px}',
			// Form styles
			'.ctd-form-title{font-size:15px;font-weight:600;color:#333;margin-bottom:12px;text-align:center}',
			'.ctd-form-subtitle{font-size:12px;color:#888;margin-bottom:14px;text-align:center}',
			'.ctd-field{margin-bottom:10px}',
			'.ctd-field label{display:block;font-size:12px;font-weight:600;color:#555;margin-bottom:4px}',
			'.ctd-field input,.ctd-field select{width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px;outline:none;transition:border-color .2s}',
			'.ctd-field input:focus,.ctd-field select:focus{border-color:#1a73e8}',
			'.ctd-field input.ctd-input-error,.ctd-field select.ctd-input-error{border-color:#e53935}',
			'.ctd-field .ctd-field-hint{font-size:11px;color:#888;margin-top:2px}',
			'.ctd-field .ctd-field-error{font-size:11px;color:#e53935;margin-top:2px}',
			'.ctd-form-error{background:#ffebee;color:#c62828;padding:8px 10px;border-radius:6px;font-size:12px;margin-bottom:10px;text-align:center}',
			// Call button in form
			'.ctd-btn{width:100%;padding:12px;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:background .15s}',
			'.ctd-btn-call{background:#43a047;color:#fff;margin-top:6px}',
			'.ctd-btn-call:hover{background:#388e3c}',
			'.ctd-btn-call:disabled{background:#bbb;cursor:default}',
			'.ctd-btn-hangup{background:#e53935;color:#fff}',
			'.ctd-btn-hangup:hover{background:#c62828}',
			'.ctd-btn-newcall{background:#f5f5f5;color:#555;margin-top:8px;font-size:13px}',
			'.ctd-btn-newcall:hover{background:#e8e8e8}',
			// In-call
			'.ctd-call-info{text-align:center;padding:16px 0}',
			'.ctd-call-icon{font-size:36px;margin-bottom:8px}',
			'.ctd-call-label{font-size:13px;color:#888}',
			'.ctd-call-number{font-size:18px;font-weight:600;color:#333;margin:4px 0}',
			'.ctd-call-caller{font-size:12px;color:#888;margin:2px 0}',
			'.ctd-call-timer{font-size:24px;font-weight:300;color:#555;font-variant-numeric:tabular-nums;margin:8px 0}',
			// In-call buttons
			'.ctd-call-btns{display:flex;gap:8px;margin:12px 0 4px}',
			'.ctd-btn-sm{flex:1;padding:8px;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;color:#555;background:#f0f0f0;transition:background .15s}',
			'.ctd-btn-sm:hover{background:#e0e0e0}',
			'.ctd-btn-sm.ctd-active{background:#1a73e8;color:#fff}',
			// DTMF mini grid
			'.ctd-dtmf-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:3px;margin-top:10px}',
			'.ctd-dtmf-key{height:32px;border:none;border-radius:4px;background:#f5f5f5;cursor:pointer;font-size:14px;font-weight:500;color:#333}',
			'.ctd-dtmf-key:hover{background:#e8e8e8}',
			// Status message
			'.ctd-status-msg{text-align:center;padding:20px;color:#888;font-size:13px}',
			// Connecting animation
			'.ctd-connecting{display:flex;align-items:center;justify-content:center;gap:4px;padding:20px}',
			'.ctd-dot{width:6px;height:6px;border-radius:50%;background:#888;animation:ctd-bounce .6s infinite alternate}',
			'.ctd-dot:nth-child(2){animation-delay:.2s}',
			'.ctd-dot:nth-child(3){animation-delay:.4s}',
			'@keyframes ctd-bounce{to{opacity:.3;transform:translateY(-4px)}}',
			// Dark mode
			'@media(prefers-color-scheme:dark){',
			'#ctd-panel{background:#1e1e1e}',
			'.ctd-form-title{color:#e0e0e0}',
			'.ctd-field label{color:#bbb}',
			'.ctd-field input,.ctd-field select{background:#2a2a2a;border-color:#444;color:#e0e0e0}',
			'.ctd-call-number{color:#e0e0e0}',
			'.ctd-call-timer{color:#bbb}',
			'.ctd-btn-sm{background:#2a2a2a;color:#bbb}',
			'.ctd-btn-sm:hover{background:#333}',
			'.ctd-dtmf-key{background:#2a2a2a;color:#e0e0e0}',
			'.ctd-dtmf-key:hover{background:#333}',
			'.ctd-btn-newcall{background:#2a2a2a;color:#bbb}',
			'}'
		].join('\n');

		var style = document.createElement('style');
		style.id = 'ctd-styles';
		style.textContent = css;
		document.head.appendChild(style);
	}

	// --- Load JsSIP ---
	function loadJsSIP(callback) {
		if (window.JsSIP) { console.log('CTD: JsSIP already loaded'); state.jssipLoaded = true; callback(); return; }
		console.log('CTD: Loading JsSIP from', CTD_SERVER + '/app/webrtc_phone/resources/js/jssip.min.js');
		var s = document.createElement('script');
		s.src = CTD_SERVER + '/app/webrtc_phone/resources/js/jssip.min.js';
		s.onload = function () { console.log('CTD: JsSIP loaded successfully'); state.jssipLoaded = true; callback(); };
		s.onerror = function () { console.error('CTD: Failed to load JsSIP'); renderStatus('Failed to load phone library.'); };
		document.head.appendChild(s);
	}

	// --- Fetch Config ---
	function fetchConfig(callback) {
		var apiUrl = CTD_SERVER + '/app/webrtc_phone/click_to_dial/click_to_dial_api.php?token=' + encodeURIComponent(CTD_TOKEN);
		console.log('CTD: Fetching config from', apiUrl);
		var xhr = new XMLHttpRequest();
		xhr.open('GET', apiUrl, true);
		xhr.onreadystatechange = function () {
			if (xhr.readyState === 4) {
				console.log('CTD: API response status:', xhr.status);
				if (xhr.status === 200) {
					try {
						var data = JSON.parse(xhr.responseText);
						console.log('CTD: Config loaded, domain:', data.domain, 'ext:', data.extension, 'dest:', data.destination_number);
						if (data.error) { console.error('CTD: API error:', data.error); renderStatus('Configuration error: ' + data.error); return; }
						state.config = data;
						state.destinationNumber = data.destination_number || '';
						state.departments = data.departments || [];
						if (data.ui) {
							state.uiColor = data.ui.button_color || '#1a73e8';
							state.position = data.ui.button_position || 'bottom-right';
							state.buttonLabel = data.ui.button_label || '';
						}
						callback();
					} catch (e) {
						console.error('CTD: Failed to parse config response:', e, xhr.responseText.substring(0, 200));
						renderStatus('Failed to parse configuration.');
					}
				} else {
					console.error('CTD: API request failed, status:', xhr.status, 'response:', xhr.responseText.substring(0, 200));
					renderStatus('Failed to load configuration (HTTP ' + xhr.status + ').');
				}
			}
		};
		xhr.onerror = function () {
			console.error('CTD: Network error fetching config (CORS blocked or network failure)');
			renderStatus('Network error loading configuration.');
		};
		xhr.send();
	}

	// --- Phone Number Validation ---
	function validatePhone(phone) {
		// Remove spaces, dashes, parentheses
		var cleaned = phone.replace(/[\s\-\(\)\.]/g, '');
		// Must start with + or digit, contain only digits after optional +
		if (!/^\+?\d{7,15}$/.test(cleaned)) {
			return false;
		}
		return true;
	}

	function cleanPhone(phone) {
		return phone.replace(/[\s\-\(\)\.]/g, '');
	}

	// --- SIP Registration ---
	function registerSIP() {
		if (!state.config || !window.JsSIP) return;

		var cfg = state.config;
		var wssUrl = 'wss://' + cfg.domain + ':' + cfg.wss_port;
		var sipUri = 'sip:' + cfg.extension + '@' + cfg.domain;

		console.log('CTD: Registering SIP -', sipUri, 'via', wssUrl);

		try {
			var socket = new JsSIP.WebSocketInterface(wssUrl);
			var configuration = {
				sockets: [socket],
				uri: sipUri,
				password: cfg.password,
				display_name: cfg.caller_id_name || cfg.extension,
				register: true,
				session_timers: false,
				user_agent: 'FusionPBX-ClickToDial/1.0'
			};

			state.ua = new JsSIP.UA(configuration);

			state.ua.on('connected', function () {
				console.log('CTD: WebSocket connected');
			});
			state.ua.on('registered', function () {
				console.log('CTD: SIP registered successfully');
				state.registered = true;
				updateFAB();
				if (state.visible) renderPanel();
			});
			state.ua.on('unregistered', function () {
				console.log('CTD: SIP unregistered');
				state.registered = false;
				updateFAB();
				if (state.visible) renderPanel();
			});
			state.ua.on('registrationFailed', function (e) {
				state.registered = false;
				console.error('CTD: SIP registration failed -', e.cause);
				updateFAB();
				if (state.visible) renderPanel();
			});
			state.ua.on('disconnected', function () {
				console.log('CTD: WebSocket disconnected');
				state.registered = false;
				if (state.session) endCall();
				else { updateFAB(); if (state.visible) renderPanel(); }
			});
			state.ua.on('newRTCSession', function (data) {
				// Click-to-Dial is outbound only — reject incoming calls
				if (data.originator === 'remote') {
					try { data.session.terminate({ status_code: 486 }); } catch (e) {}
				}
			});

			state.ua.start();
		} catch (e) {
			console.error('CTD: SIP error', e);
			renderStatus('Connection error.');
		}
	}

	// --- Call Functions ---
	function makeCall() {
		if (!state.ua || !state.registered || !state.destinationNumber) return;

		var domain = state.config.domain;
		var target = state.destinationNumber;
		var targetURI = 'sip:' + target + '@' + domain;

		var iceServers = [];
		if (state.config.stun_server) {
			iceServers.push({ urls: state.config.stun_server });
		}

		// Build caller ID display name: "Name [Department]"
		var displayName = state.callerName;
		if (state.callerDepartment) {
			displayName += ' [' + state.callerDepartment + ']';
		}

		// Build extra SIP headers with caller info
		var extraHeaders = [
			'X-CTD-Caller-Name: ' + state.callerName,
			'X-CTD-Caller-Number: ' + cleanPhone(state.callerPhone),
			'X-CTD-Department: ' + (state.callerDepartment || ''),
			'P-Preferred-Identity: "' + displayName + '" <sip:' + cleanPhone(state.callerPhone) + '@' + domain + '>'
		];

		var eventHandlers = {
			'peerconnection': function (data) {
				var pc = data.peerconnection;
				pc.ontrack = function (event) {
					if (event.streams && event.streams[0]) {
						state.remoteAudio.srcObject = event.streams[0];
					} else if (event.track) {
						if (!state.remoteAudio.srcObject) state.remoteAudio.srcObject = new MediaStream();
						state.remoteAudio.srcObject.addTrack(event.track);
					}
					state.remoteAudio.play().catch(function () {});
				};
				pc.addEventListener('connectionstatechange', function () {
					if (pc.connectionState === 'connected' && state.callState === 'in_call' && !state.callTimer) startCallTimer();
				});
			},
			'accepted': function () {
				state.callState = 'in_call';
				renderPanel();
			},
			'confirmed': function () {
				state.callState = 'in_call';
				if (state.session && !state.remoteAudio.srcObject) attachRemoteAudio(state.session);
				renderPanel();
			},
			'ended': function () { endCall(); },
			'failed': function (data) {
				console.error('CTD: Call failed', data.cause);
				endCall();
			},
			'getusermediafailed': function () {
				console.error('CTD: Microphone access denied');
				endCall();
			}
		};

		var options = {
			eventHandlers: eventHandlers,
			mediaConstraints: { audio: true, video: false },
			pcConfig: { iceServers: iceServers },
			rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false },
			extraHeaders: extraHeaders,
			fromDisplayName: displayName
		};

		try {
			state.session = state.ua.call(targetURI, options);
			state.callState = 'ringing_out';
			state.muted = false;
			state.held = false;
			showPanel();
			renderPanel();
		} catch (e) {
			console.error('CTD: Call exception', e);
			endCall();
		}
	}

	function attachRemoteAudio(session) {
		try {
			var pc = session.connection;
			if (!pc) return;
			var receivers = pc.getReceivers();
			if (receivers.length > 0) {
				var stream = new MediaStream();
				receivers.forEach(function (r) { if (r.track) stream.addTrack(r.track); });
				state.remoteAudio.srcObject = stream;
				state.remoteAudio.play().catch(function () {});
			}
		} catch (e) {}
	}

	function hangup() {
		if (!state.session) return;
		try { state.session.terminate(); } catch (e) {}
		endCall();
	}

	function toggleMute() {
		if (!state.session || state.callState !== 'in_call') return;
		state.muted = !state.muted;
		try {
			if (state.muted) state.session.mute({ audio: true });
			else state.session.unmute({ audio: true });
		} catch (e) { state.muted = !state.muted; }
		renderPanel();
	}

	function toggleHold() {
		if (!state.session || state.callState !== 'in_call') return;
		state.held = !state.held;
		try {
			if (state.held) state.session.hold();
			else state.session.unhold();
		} catch (e) { state.held = !state.held; }
		renderPanel();
	}

	function sendDTMF(tone) {
		if (!state.session || state.callState !== 'in_call') return;
		try {
			state.session.sendDTMF(tone, { duration: 100, interToneGap: 50, transportType: 'RFC2833' });
		} catch (e) {
			try { state.session.sendDTMF(tone, { duration: 100, interToneGap: 50 }); } catch (e2) {}
		}
	}

	function endCall() {
		stopCallTimer();
		state.session = null;
		state.callState = 'idle';
		state.muted = false;
		state.held = false;
		if (state.remoteAudio) state.remoteAudio.srcObject = null;
		updateFAB();
		renderPanel();
	}

	function resetForm() {
		state.callerName = '';
		state.callerPhone = '';
		state.callerDepartment = '';
		state.formSubmitted = false;
		state.formError = '';
		renderPanel();
	}

	function startCallTimer() {
		state.callDuration = 0;
		stopCallTimer();
		state.callTimer = setInterval(function () {
			state.callDuration++;
			var el = document.getElementById('ctd-timer');
			if (el) el.textContent = formatDuration(state.callDuration);
		}, 1000);
	}

	function stopCallTimer() {
		if (state.callTimer) { clearInterval(state.callTimer); state.callTimer = null; }
		state.callDuration = 0;
	}

	function formatDuration(sec) {
		var m = Math.floor(sec / 60);
		var s = sec % 60;
		return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
	}

	// --- UI ---
	function buildUI() {
		var container = document.createElement('div');
		container.id = 'ctd-container';
		container.className = 'ctd-' + state.position;

		// FAB button
		var fab = document.createElement('button');
		fab.id = 'ctd-fab';
		fab.style.background = state.uiColor;
		if (!state.buttonLabel) fab.className = 'ctd-fab-icon-only';
		fab.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
		if (state.buttonLabel) fab.innerHTML += '<span class="ctd-fab-label">' + escapeHtml(state.buttonLabel) + '</span>';
		fab.innerHTML += '<span id="ctd-badge" class="ctd-badge"></span>';
		fab.addEventListener('click', function () { togglePanel(); });

		// Panel
		var panel = document.createElement('div');
		panel.id = 'ctd-panel';

		container.appendChild(fab);
		container.appendChild(panel);
		document.body.appendChild(container);

		// Remote audio element
		state.remoteAudio = document.createElement('audio');
		state.remoteAudio.id = 'ctd-remote-audio';
		state.remoteAudio.autoplay = true;
		document.body.appendChild(state.remoteAudio);

		renderPanel();
	}

	function updateFAB() {
		var fab = document.getElementById('ctd-fab');
		if (!fab) return;
		if (state.callState !== 'idle') {
			fab.style.background = '#e53935';
		} else {
			fab.style.background = state.uiColor;
		}
	}

	function togglePanel() {
		state.visible = !state.visible;
		var panel = document.getElementById('ctd-panel');
		if (panel) panel.classList.toggle('ctd-open', state.visible);
	}

	function showPanel() {
		state.visible = true;
		var panel = document.getElementById('ctd-panel');
		if (panel) panel.classList.add('ctd-open');
	}

	function renderStatus(msg) {
		var panel = document.getElementById('ctd-panel');
		if (!panel) return;
		panel.innerHTML = renderHeader() + '<div class="ctd-body"><div class="ctd-status-msg">' + escapeHtml(msg) + '</div></div>';
	}

	function renderHeader() {
		var statusText = state.registered ? 'Ready' : 'Connecting...';
		var title = state.config ? (state.config.caller_id_name || 'Click to Call') : 'Click to Call';

		return '<div class="ctd-header" style="background:' + state.uiColor + '">'
			+ '<span class="ctd-header-title">' + escapeHtml(title) + '</span>'
			+ '<span class="ctd-header-status">' + statusText + '</span>'
			+ '<button class="ctd-close-btn" id="ctd-close-btn">&times;</button>'
			+ '</div>';
	}

	function renderPanel() {
		var panel = document.getElementById('ctd-panel');
		if (!panel) return;

		var html = renderHeader();
		html += '<div class="ctd-body">';

		if (!state.registered && state.callState === 'idle') {
			// Still connecting
			html += '<div class="ctd-connecting"><span class="ctd-dot"></span><span class="ctd-dot"></span><span class="ctd-dot"></span></div>';
			html += '<div class="ctd-status-msg">Connecting...</div>';
		} else if (state.callState === 'idle' && !state.formSubmitted) {
			// Show visitor info form
			html += renderCallerForm();
		} else if (state.callState === 'ringing_out') {
			html += '<div class="ctd-call-info">';
			html += '<div class="ctd-call-icon">&#128222;</div>';
			html += '<div class="ctd-call-label">Calling...</div>';
			html += '<div class="ctd-call-number">' + escapeHtml(state.destinationNumber) + '</div>';
			html += '<div class="ctd-call-caller">' + escapeHtml(state.callerName);
			if (state.callerDepartment) html += ' - ' + escapeHtml(state.callerDepartment);
			html += '</div>';
			html += '</div>';
			html += '<button class="ctd-btn ctd-btn-hangup" id="ctd-hangup-btn">Cancel</button>';
		} else if (state.callState === 'in_call') {
			html += '<div class="ctd-call-info">';
			html += '<div class="ctd-call-icon" style="color:#43a047">&#128222;</div>';
			html += '<div class="ctd-call-label">Connected</div>';
			html += '<div class="ctd-call-number">' + escapeHtml(state.callerName) + '</div>';
			html += '<div class="ctd-call-caller">' + escapeHtml(cleanPhone(state.callerPhone));
			if (state.callerDepartment) html += ' - ' + escapeHtml(state.callerDepartment);
			html += '</div>';
			html += '<div class="ctd-call-timer" id="ctd-timer">' + formatDuration(state.callDuration) + '</div>';
			html += '</div>';
			html += '<div class="ctd-call-btns">';
			html += '<button class="ctd-btn-sm' + (state.muted ? ' ctd-active' : '') + '" id="ctd-mute-btn">' + (state.muted ? 'Unmute' : 'Mute') + '</button>';
			html += '<button class="ctd-btn-sm' + (state.held ? ' ctd-active' : '') + '" id="ctd-hold-btn">' + (state.held ? 'Resume' : 'Hold') + '</button>';
			html += '</div>';
			html += '<button class="ctd-btn ctd-btn-hangup" id="ctd-hangup-btn" style="margin-top:8px">Hang Up</button>';
			// DTMF pad
			html += '<div class="ctd-dtmf-grid">';
			var dtmfKeys = ['1','2','3','4','5','6','7','8','9','*','0','#'];
			for (var i = 0; i < dtmfKeys.length; i++) {
				html += '<button class="ctd-dtmf-key" data-dtmf="' + dtmfKeys[i] + '">' + dtmfKeys[i] + '</button>';
			}
			html += '</div>';
		} else if (state.callState === 'idle' && state.formSubmitted) {
			// Call ended - show "call again" option
			html += '<div class="ctd-call-info">';
			html += '<div class="ctd-call-icon">&#9989;</div>';
			html += '<div class="ctd-call-label">Call Ended</div>';
			html += '<div class="ctd-call-number">' + escapeHtml(state.callerName) + '</div>';
			html += '</div>';
			html += '<button class="ctd-btn ctd-btn-call" id="ctd-recall-btn">Call Again</button>';
			html += '<button class="ctd-btn ctd-btn-newcall" id="ctd-newcall-btn">New Call</button>';
		}

		html += '</div>';
		panel.innerHTML = html;

		// Bind events
		bindPanelEvents();
	}

	function renderCallerForm() {
		var html = '';
		html += '<div class="ctd-form-title">Enter Your Details</div>';
		html += '<div class="ctd-form-subtitle">We\'ll call you right away</div>';

		if (state.formError) {
			html += '<div class="ctd-form-error">' + escapeHtml(state.formError) + '</div>';
		}

		// Name field
		html += '<div class="ctd-field">';
		html += '<label for="ctd-name">Your Name *</label>';
		html += '<input type="text" id="ctd-name" placeholder="John Doe" value="' + escapeHtml(state.callerName) + '" autocomplete="name">';
		html += '</div>';

		// Phone field
		html += '<div class="ctd-field">';
		html += '<label for="ctd-phone">Phone Number *</label>';
		html += '<input type="tel" id="ctd-phone" placeholder="+1 (555) 123-4567" value="' + escapeHtml(state.callerPhone) + '" autocomplete="tel">';
		html += '<div class="ctd-field-hint">Include country code (e.g. +1 for US)</div>';
		html += '</div>';

		// Department dropdown (if departments configured)
		if (state.departments.length > 0) {
			html += '<div class="ctd-field">';
			html += '<label for="ctd-department">Department *</label>';
			html += '<select id="ctd-department">';
			html += '<option value="">-- Select Department --</option>';
			for (var i = 0; i < state.departments.length; i++) {
				var selected = (state.departments[i] === state.callerDepartment) ? ' selected' : '';
				html += '<option value="' + escapeHtml(state.departments[i]) + '"' + selected + '>' + escapeHtml(state.departments[i]) + '</option>';
			}
			html += '</select>';
			html += '</div>';
		}

		// Call button
		html += '<button class="ctd-btn ctd-btn-call" id="ctd-submit-btn"' + (!state.registered ? ' disabled' : '') + '>';
		html += '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/></svg>';
		html += ' Call Now</button>';

		return html;
	}

	function submitForm() {
		// Read form values
		var nameEl = document.getElementById('ctd-name');
		var phoneEl = document.getElementById('ctd-phone');
		var deptEl = document.getElementById('ctd-department');

		state.callerName = nameEl ? nameEl.value.trim() : '';
		state.callerPhone = phoneEl ? phoneEl.value.trim() : '';
		state.callerDepartment = deptEl ? deptEl.value : '';

		// Validate
		state.formError = '';

		if (!state.callerName) {
			state.formError = 'Please enter your name.';
			renderPanel();
			var el = document.getElementById('ctd-name');
			if (el) { el.classList.add('ctd-input-error'); el.focus(); }
			return;
		}

		if (!state.callerPhone) {
			state.formError = 'Please enter your phone number.';
			renderPanel();
			var el2 = document.getElementById('ctd-phone');
			if (el2) { el2.classList.add('ctd-input-error'); el2.focus(); }
			return;
		}

		if (!validatePhone(state.callerPhone)) {
			state.formError = 'Please enter a valid phone number (7-15 digits, with optional + country code).';
			renderPanel();
			var el3 = document.getElementById('ctd-phone');
			if (el3) { el3.classList.add('ctd-input-error'); el3.focus(); }
			return;
		}

		if (state.departments.length > 0 && !state.callerDepartment) {
			state.formError = 'Please select a department.';
			renderPanel();
			var el4 = document.getElementById('ctd-department');
			if (el4) { el4.classList.add('ctd-input-error'); el4.focus(); }
			return;
		}

		if (!state.registered) {
			state.formError = 'Phone system is not ready. Please try again in a moment.';
			renderPanel();
			return;
		}

		// All valid — make the call
		state.formSubmitted = true;
		state.formError = '';
		makeCall();
	}

	function bindPanelEvents() {
		// Close button
		var closeBtn = document.getElementById('ctd-close-btn');
		if (closeBtn) closeBtn.addEventListener('click', function () { togglePanel(); });

		// Form submit
		var submitBtn = document.getElementById('ctd-submit-btn');
		if (submitBtn) submitBtn.addEventListener('click', function () { submitForm(); });

		// Enter key on form fields
		var nameField = document.getElementById('ctd-name');
		var phoneField = document.getElementById('ctd-phone');
		var deptField = document.getElementById('ctd-department');
		function onEnter(e) { if (e.key === 'Enter') submitForm(); }
		if (nameField) nameField.addEventListener('keydown', onEnter);
		if (phoneField) phoneField.addEventListener('keydown', onEnter);
		if (deptField) deptField.addEventListener('keydown', onEnter);

		// Clear error styling on input
		function clearErr() { this.classList.remove('ctd-input-error'); }
		if (nameField) nameField.addEventListener('input', clearErr);
		if (phoneField) phoneField.addEventListener('input', clearErr);
		if (deptField) deptField.addEventListener('change', clearErr);

		// Hangup
		var hangupBtn = document.getElementById('ctd-hangup-btn');
		if (hangupBtn) hangupBtn.addEventListener('click', function () { hangup(); });

		// Mute
		var muteBtn = document.getElementById('ctd-mute-btn');
		if (muteBtn) muteBtn.addEventListener('click', function () { toggleMute(); });

		// Hold
		var holdBtn = document.getElementById('ctd-hold-btn');
		if (holdBtn) holdBtn.addEventListener('click', function () { toggleHold(); });

		// DTMF keys
		var dtmfKeys = document.querySelectorAll('#ctd-panel .ctd-dtmf-key');
		for (var j = 0; j < dtmfKeys.length; j++) {
			dtmfKeys[j].addEventListener('click', function () {
				sendDTMF(this.getAttribute('data-dtmf'));
			});
		}

		// Call again (same info)
		var recallBtn = document.getElementById('ctd-recall-btn');
		if (recallBtn) recallBtn.addEventListener('click', function () {
			if (state.registered) makeCall();
		});

		// New call (reset form)
		var newCallBtn = document.getElementById('ctd-newcall-btn');
		if (newCallBtn) newCallBtn.addEventListener('click', function () { resetForm(); });
	}

	// --- Click-to-Dial: auto-detect triggers ---
	function bindClickToDial() {
		document.addEventListener('click', function (e) {
			// data-ctd-dial attribute opens the form
			var dialEl = e.target.closest('[data-ctd-dial]');
			if (dialEl) {
				e.preventDefault();
				showPanel();
				renderPanel();
			}
		}, true);
	}

	// --- Public API ---
	window.ClickToDial = {
		open: function () { showPanel(); renderPanel(); },
		hangup: function () { hangup(); },
		isRegistered: function () { return state.registered; },
		isInCall: function () { return state.callState !== 'idle'; },
		reset: function () { resetForm(); }
	};

	// --- Utility ---
	function escapeHtml(str) {
		if (!str) return '';
		var div = document.createElement('div');
		div.appendChild(document.createTextNode(str));
		return div.innerHTML;
	}

	// --- Init ---
	function init() {
		console.log('CTD: Initializing Click-to-Dial, server:', CTD_SERVER);
		injectCSS();
		fetchConfig(function () {
			console.log('CTD: Config loaded, building UI');
			buildUI();
			bindClickToDial();
			loadJsSIP(function () {
				console.log('CTD: JsSIP ready, starting SIP registration');
				registerSIP();
			});
		});
	}

	// Wait for DOM ready
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}

})();
