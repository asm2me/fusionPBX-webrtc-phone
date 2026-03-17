/*
	FusionPBX Click-to-Dial Widget
	Embeddable JavaScript plugin for third-party websites.
	Self-contained: includes CSS, JsSIP loader, SIP registration, and minimal phone UI.

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
		dialInput: '',
		callDuration: 0,
		callTimer: null,
		visible: false,
		remoteAudio: null,
		uiColor: '#1a73e8',
		position: 'bottom-right',
		buttonLabel: '',
		jssipLoaded: false
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
			'#ctd-panel{position:absolute;width:300px;background:#fff;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.25);overflow:hidden;display:none;flex-direction:column}',
			'#ctd-panel.ctd-open{display:flex}',
			// Panel position based on container position
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
			'.ctd-body{padding:12px 14px}',
			// Dial input
			'.ctd-dial-input{width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:18px;text-align:center;letter-spacing:1px;outline:none;transition:border-color .2s;margin-bottom:10px}',
			'.ctd-dial-input:focus{border-color:#1a73e8}',
			// Dialpad grid
			'.ctd-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px}',
			'.ctd-key{height:44px;border:none;border-radius:8px;background:#f5f5f5;cursor:pointer;font-size:18px;font-weight:500;color:#333;display:flex;flex-direction:column;align-items:center;justify-content:center;transition:background .15s}',
			'.ctd-key:hover{background:#e8e8e8}',
			'.ctd-key:active{background:#ddd}',
			'.ctd-key-sub{font-size:9px;color:#888;letter-spacing:1px;margin-top:-2px}',
			// Actions
			'.ctd-actions{display:flex;gap:8px;margin-top:4px}',
			'.ctd-btn{flex:1;padding:10px;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;transition:background .15s}',
			'.ctd-btn-call{background:#43a047;color:#fff}',
			'.ctd-btn-call:hover{background:#388e3c}',
			'.ctd-btn-call:disabled{background:#bbb;cursor:default}',
			'.ctd-btn-hangup{background:#e53935;color:#fff}',
			'.ctd-btn-hangup:hover{background:#c62828}',
			'.ctd-btn-back{background:#f5f5f5;color:#555;flex:0 0 44px}',
			'.ctd-btn-back:hover{background:#e8e8e8}',
			// In-call
			'.ctd-call-info{text-align:center;padding:16px 0}',
			'.ctd-call-icon{font-size:36px;margin-bottom:8px}',
			'.ctd-call-label{font-size:13px;color:#888}',
			'.ctd-call-number{font-size:20px;font-weight:600;color:#333;margin:4px 0}',
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
			// Transfer
			'.ctd-transfer{display:flex;gap:6px;margin-top:8px}',
			'.ctd-transfer input{flex:1;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:13px;outline:none}',
			'.ctd-transfer button{padding:6px 12px;border:none;border-radius:6px;background:#1a73e8;color:#fff;font-size:12px;font-weight:600;cursor:pointer}',
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
			'.ctd-dial-input{background:#2a2a2a;border-color:#444;color:#e0e0e0}',
			'.ctd-key{background:#2a2a2a;color:#e0e0e0}',
			'.ctd-key:hover{background:#333}',
			'.ctd-key-sub{color:#777}',
			'.ctd-call-number{color:#e0e0e0}',
			'.ctd-call-timer{color:#bbb}',
			'.ctd-btn-sm{background:#2a2a2a;color:#bbb}',
			'.ctd-btn-sm:hover{background:#333}',
			'.ctd-dtmf-key{background:#2a2a2a;color:#e0e0e0}',
			'.ctd-dtmf-key:hover{background:#333}',
			'.ctd-transfer input{background:#2a2a2a;border-color:#444;color:#e0e0e0}',
			'.ctd-btn-back{background:#2a2a2a;color:#bbb}',
			'}'
		].join('\n');

		var style = document.createElement('style');
		style.id = 'ctd-styles';
		style.textContent = css;
		document.head.appendChild(style);
	}

	// --- Load JsSIP ---
	function loadJsSIP(callback) {
		if (window.JsSIP) { state.jssipLoaded = true; callback(); return; }
		var s = document.createElement('script');
		s.src = CTD_SERVER + '/app/webrtc_phone/resources/js/jssip.min.js';
		s.onload = function () { state.jssipLoaded = true; callback(); };
		s.onerror = function () { console.error('CTD: Failed to load JsSIP'); renderStatus('Failed to load phone library.'); };
		document.head.appendChild(s);
	}

	// --- Fetch Config ---
	function fetchConfig(callback) {
		var xhr = new XMLHttpRequest();
		xhr.open('GET', CTD_SERVER + '/app/webrtc_phone/click_to_dial/click_to_dial_api.php?token=' + encodeURIComponent(CTD_TOKEN), true);
		xhr.setRequestHeader('X-CTD-Token', CTD_TOKEN);
		xhr.onreadystatechange = function () {
			if (xhr.readyState === 4) {
				if (xhr.status === 200) {
					try {
						var data = JSON.parse(xhr.responseText);
						if (data.error) { renderStatus('Configuration error: ' + data.error); return; }
						state.config = data;
						if (data.ui) {
							state.uiColor = data.ui.button_color || '#1a73e8';
							state.position = data.ui.button_position || 'bottom-right';
							state.buttonLabel = data.ui.button_label || '';
						}
						callback();
					} catch (e) {
						renderStatus('Failed to parse configuration.');
					}
				} else {
					renderStatus('Failed to load configuration (HTTP ' + xhr.status + ').');
				}
			}
		};
		xhr.send();
	}

	// --- SIP Registration ---
	function registerSIP() {
		if (!state.config || !window.JsSIP) return;

		var cfg = state.config;
		var wssUrl = 'wss://' + cfg.domain + ':' + cfg.wss_port;
		var sipUri = 'sip:' + cfg.extension + '@' + cfg.domain;

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

			state.ua.on('registered', function () {
				state.registered = true;
				updateFAB();
				if (state.visible) renderPanel();
			});
			state.ua.on('unregistered', function () {
				state.registered = false;
				updateFAB();
				if (state.visible) renderPanel();
			});
			state.ua.on('registrationFailed', function (e) {
				state.registered = false;
				console.error('CTD: Registration failed', e.cause);
				updateFAB();
				if (state.visible) renderPanel();
			});
			state.ua.on('disconnected', function () {
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
	function makeCall(target) {
		if (!state.ua || !state.registered || !target) return;

		var domain = state.config.domain;
		var targetURI = 'sip:' + target + '@' + domain;

		var iceServers = [];
		if (state.config.stun_server) {
			iceServers.push({ urls: state.config.stun_server });
		}

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
			rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false }
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

	function transferCall(target) {
		if (!state.session || state.callState !== 'in_call' || !target) return;
		var uri = 'sip:' + target + '@' + state.config.domain;
		try { state.session.refer(uri); } catch (e) {}
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
		var statusClass = state.registered ? 'ctd-ready' : 'ctd-connecting';
		var title = state.config ? (state.config.caller_id_name || state.config.extension || 'Phone') : 'Phone';

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
			html += '<div class="ctd-connecting"><span class="ctd-dot"></span><span class="ctd-dot"></span><span class="ctd-dot"></span></div>';
			html += '<div class="ctd-status-msg">Connecting to PBX...</div>';
		} else if (state.callState === 'idle') {
			html += renderDialPad();
		} else if (state.callState === 'ringing_out') {
			html += '<div class="ctd-call-info">';
			html += '<div class="ctd-call-icon">&#128222;</div>';
			html += '<div class="ctd-call-label">Calling...</div>';
			html += '<div class="ctd-call-number">' + escapeHtml(state.dialInput) + '</div>';
			html += '</div>';
			html += '<div class="ctd-actions">';
			html += '<button class="ctd-btn ctd-btn-hangup" id="ctd-hangup-btn">Hang Up</button>';
			html += '</div>';
		} else if (state.callState === 'in_call') {
			html += '<div class="ctd-call-info">';
			html += '<div class="ctd-call-icon" style="color:#43a047">&#128222;</div>';
			html += '<div class="ctd-call-label">In Call</div>';
			html += '<div class="ctd-call-number">' + escapeHtml(state.dialInput) + '</div>';
			html += '<div class="ctd-call-timer" id="ctd-timer">' + formatDuration(state.callDuration) + '</div>';
			html += '</div>';
			html += '<div class="ctd-call-btns">';
			html += '<button class="ctd-btn-sm' + (state.muted ? ' ctd-active' : '') + '" id="ctd-mute-btn">' + (state.muted ? 'Unmute' : 'Mute') + '</button>';
			html += '<button class="ctd-btn-sm' + (state.held ? ' ctd-active' : '') + '" id="ctd-hold-btn">' + (state.held ? 'Resume' : 'Hold') + '</button>';
			html += '</div>';
			html += '<div class="ctd-actions">';
			html += '<button class="ctd-btn ctd-btn-hangup" id="ctd-hangup-btn">Hang Up</button>';
			html += '</div>';
			// DTMF pad
			html += '<div class="ctd-dtmf-grid">';
			var dtmfKeys = ['1','2','3','4','5','6','7','8','9','*','0','#'];
			for (var i = 0; i < dtmfKeys.length; i++) {
				html += '<button class="ctd-dtmf-key" data-dtmf="' + dtmfKeys[i] + '">' + dtmfKeys[i] + '</button>';
			}
			html += '</div>';
			// Transfer
			html += '<div class="ctd-transfer">';
			html += '<input type="text" id="ctd-transfer-input" placeholder="Transfer to...">';
			html += '<button id="ctd-transfer-btn">Transfer</button>';
			html += '</div>';
		}

		html += '</div>';
		panel.innerHTML = html;

		// Bind events
		bindPanelEvents();
	}

	function renderDialPad() {
		var html = '';
		html += '<input type="text" class="ctd-dial-input" id="ctd-dial-input" placeholder="Enter number..." value="' + escapeHtml(state.dialInput) + '">';
		html += '<div class="ctd-grid">';
		var keys = [
			{ k: '1', s: '' }, { k: '2', s: 'ABC' }, { k: '3', s: 'DEF' },
			{ k: '4', s: 'GHI' }, { k: '5', s: 'JKL' }, { k: '6', s: 'MNO' },
			{ k: '7', s: 'PQRS' }, { k: '8', s: 'TUV' }, { k: '9', s: 'WXYZ' },
			{ k: '*', s: '' }, { k: '0', s: '+' }, { k: '#', s: '' }
		];
		for (var i = 0; i < keys.length; i++) {
			html += '<button class="ctd-key" data-key="' + keys[i].k + '">';
			html += '<span>' + keys[i].k + '</span>';
			if (keys[i].s) html += '<span class="ctd-key-sub">' + keys[i].s + '</span>';
			html += '</button>';
		}
		html += '</div>';
		html += '<div class="ctd-actions">';
		html += '<button class="ctd-btn ctd-btn-back" id="ctd-backspace-btn" title="Backspace">&#9003;</button>';
		html += '<button class="ctd-btn ctd-btn-call" id="ctd-call-btn"' + (!state.registered ? ' disabled' : '') + '>';
		html += '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/></svg>';
		html += ' Call</button>';
		html += '</div>';
		return html;
	}

	function bindPanelEvents() {
		// Close button
		var closeBtn = document.getElementById('ctd-close-btn');
		if (closeBtn) closeBtn.addEventListener('click', function () { togglePanel(); });

		// Dial keys
		var keys = document.querySelectorAll('#ctd-panel .ctd-key');
		for (var i = 0; i < keys.length; i++) {
			keys[i].addEventListener('click', function () {
				var k = this.getAttribute('data-key');
				state.dialInput += k;
				var input = document.getElementById('ctd-dial-input');
				if (input) { input.value = state.dialInput; input.focus(); }
			});
		}

		// Dial input
		var dialInput = document.getElementById('ctd-dial-input');
		if (dialInput) {
			dialInput.addEventListener('input', function () { state.dialInput = this.value; });
			dialInput.addEventListener('keydown', function (e) {
				if (e.key === 'Enter') doCall();
			});
		}

		// Call button
		var callBtn = document.getElementById('ctd-call-btn');
		if (callBtn) callBtn.addEventListener('click', function () { doCall(); });

		// Backspace
		var backBtn = document.getElementById('ctd-backspace-btn');
		if (backBtn) backBtn.addEventListener('click', function () {
			if (state.dialInput.length > 0) {
				state.dialInput = state.dialInput.slice(0, -1);
				var input = document.getElementById('ctd-dial-input');
				if (input) input.value = state.dialInput;
			}
		});

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

		// Transfer
		var transferBtn = document.getElementById('ctd-transfer-btn');
		if (transferBtn) transferBtn.addEventListener('click', function () {
			var input = document.getElementById('ctd-transfer-input');
			if (input && input.value.trim()) transferCall(input.value.trim());
		});
	}

	function doCall() {
		var input = document.getElementById('ctd-dial-input');
		if (input) state.dialInput = input.value.trim();
		if (!state.dialInput) return;
		makeCall(state.dialInput);
	}

	// --- Click-to-Dial: auto-detect phone links ---
	function bindClickToDial() {
		// Bind to tel: links
		document.addEventListener('click', function (e) {
			var link = e.target.closest('a[href^="tel:"]');
			if (link) {
				e.preventDefault();
				var number = link.getAttribute('href').replace(/^tel:\+?/, '').replace(/[^\d*#]/g, '');
				if (number) dialNumber(number);
				return;
			}

			// Bind to data-ctd-dial elements
			var dialEl = e.target.closest('[data-ctd-dial]');
			if (dialEl) {
				e.preventDefault();
				var num = dialEl.getAttribute('data-ctd-dial');
				if (num) dialNumber(num);
			}
		}, true);

		// Auto-dial on page load
		var autoDialEls = document.querySelectorAll('[data-ctd-auto-dial]');
		if (autoDialEls.length > 0) {
			var num = autoDialEls[0].getAttribute('data-ctd-auto-dial');
			if (num) {
				// Wait for registration
				var checkInterval = setInterval(function () {
					if (state.registered) {
						clearInterval(checkInterval);
						dialNumber(num);
					}
				}, 500);
				// Timeout after 15 seconds
				setTimeout(function () { clearInterval(checkInterval); }, 15000);
			}
		}
	}

	function dialNumber(number) {
		state.dialInput = number;
		showPanel();
		if (state.registered && state.callState === 'idle') {
			makeCall(number);
		} else {
			renderPanel();
		}
	}

	// --- Public API ---
	window.ClickToDial = {
		dial: function (number) { dialNumber(number); },
		hangup: function () { hangup(); },
		isRegistered: function () { return state.registered; },
		isInCall: function () { return state.callState !== 'idle'; }
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
		injectCSS();
		fetchConfig(function () {
			buildUI();
			bindClickToDial();
			loadJsSIP(function () {
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
