/*
	FusionPBX Web Phone 2
	Browser-based SIP softphone using JsSIP over WebSocket Secure (WSS).
	Fetches the active user's extensions from FusionPBX and registers via WebRTC.
*/

var WebPhone2 = (function () {
	'use strict';

	// State
	var state = {
		initialized: false,
		visible: false,
		config: null,
		extensions: [],
		selectedExtension: null,
		ua: null,             // JsSIP UserAgent
		currentSession: null, // Active call session
		registered: false,
		callState: 'idle',    // idle, ringing_in, ringing_out, in_call
		muted: false,
		held: false,
		dialInput: '',
		callTimer: null,
		callDuration: 0,
		remoteAudio: null,
		ringtoneAudio: null,
		localStream: null,
		mountEl: null,
		incomingNotification: null
	};

	// --- Initialization ---

	function init(mountId) {
		if (state.initialized) return;
		state.mountEl = document.getElementById(mountId);
		if (!state.mountEl) return;

		// Create hidden audio element for remote audio
		state.remoteAudio = document.createElement('audio');
		state.remoteAudio.id = 'web-phone2-remote-audio';
		state.remoteAudio.autoplay = true;
		document.body.appendChild(state.remoteAudio);

		// Create ringtone audio
		state.ringtoneAudio = document.createElement('audio');
		state.ringtoneAudio.id = 'web-phone2-ringtone';
		state.ringtoneAudio.loop = true;
		state.ringtoneAudio.src = generateRingtoneDataURI();
		document.body.appendChild(state.ringtoneAudio);

		state.initialized = true;

		// Request notification permission early
		requestNotificationPermission();

		fetchConfig();
	}

	function requestNotificationPermission() {
		if (!('Notification' in window)) return;
		if (Notification.permission === 'default') {
			Notification.requestPermission().then(function (perm) {
				console.log('Web Phone 2: Notification permission:', perm);
			});
		}
	}

	function fetchConfig() {
		var xhr = new XMLHttpRequest();
		xhr.open('GET', '/app/web_phone2/web_phone2_api.php', true);
		xhr.onreadystatechange = function () {
			if (xhr.readyState === 4) {
				if (xhr.status === 200) {
					try {
						var data = JSON.parse(xhr.responseText);
						if (data.error) {
							renderError(data.error);
							return;
						}
						state.config = data;
						state.extensions = data.extensions || [];
						if (state.extensions.length === 0) {
							renderError('No extensions assigned to your account.');
						} else if (state.extensions.length === 1) {
							state.selectedExtension = state.extensions[0];
							renderPhone();
							registerSIP();
						} else {
							renderExtensionSelector();
						}
					} catch (e) {
						renderError('Failed to parse server response.');
					}
				} else {
					renderError('Failed to load phone configuration.');
				}
			}
		};
		xhr.send();
	}

	// --- SIP Registration with JsSIP ---

	function registerSIP() {
		if (!state.selectedExtension || !state.config) return;

		var ext = state.selectedExtension;
		var domain = state.config.domain;
		var wssPort = state.config.wss_port;
		var stunServer = state.config.stun_server;

		var wssUrl = 'wss://' + domain + ':' + wssPort;
		var sipUri = 'sip:' + ext.extension + '@' + domain;

		// Enable JsSIP debug logging
		JsSIP.debug.enable('JsSIP:*');

		console.log('Web Phone 2: Connecting to', wssUrl, 'as', sipUri);
		updateStatus('connecting');

		try {
			var socket = new JsSIP.WebSocketInterface(wssUrl);

			var configuration = {
				sockets: [socket],
				uri: sipUri,
				password: ext.password,
				authorization_user: (ext.auth_username || ext.extension),
				display_name: (ext.caller_id_name || ext.extension),
				register: true,
				register_expires: 300,
				session_timers: false,
				user_agent: 'FusionPBX-Web-Phone2/1.0'
			};

			state.ua = new JsSIP.UA(configuration);

			state.ua.on('registered', function () {
				state.registered = true;
				renderPhone();
			});

			state.ua.on('unregistered', function () {
				state.registered = false;
				renderPhone();
			});

			state.ua.on('registrationFailed', function (e) {
				state.registered = false;
				console.error('Web Phone 2: Registration failed', e.cause);
				renderPhone();
			});

			state.ua.on('newRTCSession', function (data) {
				console.log('Web Phone 2: newRTCSession', data.originator, data.request ? data.request.method : '');
				if (data.originator === 'remote') {
					handleIncomingCall(data.session);
				}
			});

			state.ua.on('disconnected', function () {
				state.registered = false;
				renderPhone();
			});

			state.ua.start();

		} catch (e) {
			console.error('Web Phone 2: SIP registration error', e);
			updateStatus('error');
		}
	}

	function unregisterSIP() {
		if (state.ua) {
			try {
				state.ua.unregister({ all: true });
				state.ua.stop();
			} catch (e) {}
		}
		state.ua = null;
		state.registered = false;
		updateStatus('unregistered');
	}

	// --- Call Handling ---

	function getICEServers() {
		var servers = [];
		if (state.config && state.config.stun_server) {
			servers.push({ urls: state.config.stun_server });
		}
		return servers;
	}

	function makeCall(target) {
		if (!state.ua || !state.registered || !target) return;

		var domain = state.config.domain;
		var targetURI = 'sip:' + target + '@' + domain;

		console.log('Web Phone 2: Calling', targetURI);

		var eventHandlers = {
			'peerconnection': function (data) {
				console.log('Web Phone 2: peerconnection event', data);
				data.peerconnection.ontrack = function (event) {
					console.log('Web Phone 2: remote track received', event);
					if (event.streams && event.streams[0]) {
						state.remoteAudio.srcObject = event.streams[0];
						state.remoteAudio.play().catch(function () {});
					}
				};
			},
			'connecting': function (data) {
				console.log('Web Phone 2: call connecting', data);
			},
			'sending': function (data) {
				console.log('Web Phone 2: call sending INVITE', data);
			},
			'progress': function (data) {
				console.log('Web Phone 2: call progress (ringing)', data);
			},
			'accepted': function (data) {
				console.log('Web Phone 2: call accepted', data);
				state.callState = 'in_call';
				stopRingtone();
				hideFABBadge();
				startCallTimer();
				renderPhone();
			},
			'confirmed': function (data) {
				console.log('Web Phone 2: call confirmed', data);
				state.callState = 'in_call';
				stopRingtone();
				hideFABBadge();
				renderPhone();
			},
			'ended': function (data) {
				console.log('Web Phone 2: call ended', data.cause);
				endCall();
			},
			'failed': function (data) {
				console.error('Web Phone 2: call failed', data.cause, data.message);
				endCall();
			},
			'getusermediafailed': function (data) {
				console.error('Web Phone 2: getUserMedia failed', data);
				endCall();
			}
		};

		var options = {
			eventHandlers: eventHandlers,
			mediaConstraints: { audio: true, video: false },
			pcConfig: {
				iceServers: getICEServers()
			},
			rtcOfferConstraints: {
				offerToReceiveAudio: true,
				offerToReceiveVideo: false
			}
		};

		try {
			state.currentSession = state.ua.call(targetURI, options);
			state.callState = 'ringing_out';
			state.muted = false;
			state.held = false;
			renderPhone();
			console.log('Web Phone 2: call initiated, session:', state.currentSession);
		} catch (e) {
			console.error('Web Phone 2: Call exception', e);
			endCall();
		}
	}

	function handleIncomingCall(session) {
		// If already in a call, reject the new one
		if (state.currentSession) {
			try { session.terminate({ status_code: 486 }); } catch (e) {}
			return;
		}

		state.currentSession = session;
		state.callState = 'ringing_in';
		state.muted = false;
		state.held = false;

		showPanel();
		playRingtone();
		showFABBadge('!');
		showIncomingNotification(session);

		setupSessionListeners(session);
		renderPhone();
	}

	function answerCall() {
		if (!state.currentSession || state.callState !== 'ringing_in') return;

		stopRingtone();
		hideFABBadge();
		closeIncomingNotification();

		var options = {
			mediaConstraints: { audio: true, video: false },
			pcConfig: {
				iceServers: getICEServers()
			}
		};

		try {
			state.currentSession.answer(options);
		} catch (e) {
			console.error('Web Phone 2: Answer failed', e);
			endCall();
		}
	}

	function rejectCall() {
		if (!state.currentSession || state.callState !== 'ringing_in') return;
		stopRingtone();
		hideFABBadge();
		closeIncomingNotification();

		try {
			state.currentSession.terminate({ status_code: 486, reason_phrase: 'Busy Here' });
		} catch (e) {}
		endCall();
	}

	function hangupCall() {
		if (!state.currentSession) return;
		stopRingtone();
		hideFABBadge();

		try {
			state.currentSession.terminate();
		} catch (e) {
			console.error('Web Phone 2: Hangup error', e);
		}
		endCall();
	}

	function toggleMute() {
		if (!state.currentSession || state.callState !== 'in_call') return;

		state.muted = !state.muted;
		if (state.muted) {
			state.currentSession.mute({ audio: true });
		} else {
			state.currentSession.unmute({ audio: true });
		}
		renderPhone();
	}

	function toggleHold() {
		if (!state.currentSession || state.callState !== 'in_call') return;

		state.held = !state.held;
		try {
			if (state.held) {
				state.currentSession.hold();
			} else {
				state.currentSession.unhold();
			}
		} catch (e) {
			state.held = !state.held; // revert
		}
		renderPhone();
	}

	function sendDTMF(tone) {
		if (!state.currentSession || state.callState !== 'in_call') return;
		try {
			state.currentSession.sendDTMF(tone, {
				duration: 100,
				interToneGap: 50,
				transportType: 'RFC2833'
			});
		} catch (e) {
			// Fallback to SIP INFO
			try {
				state.currentSession.sendDTMF(tone, {
					duration: 100,
					interToneGap: 50
				});
			} catch (e2) {}
		}
	}

	function transferCall(target) {
		if (!state.currentSession || state.callState !== 'in_call' || !target) return;
		var domain = state.config.domain;
		var targetURI = 'sip:' + target + '@' + domain;
		try {
			state.currentSession.refer(targetURI);
		} catch (e) {
			console.error('Web Phone 2: Transfer failed', e);
		}
	}

	function setupSessionListeners(session) {
		session.on('progress', function () {
			// Ringing (outgoing)
		});

		session.on('accepted', function () {
			state.callState = 'in_call';
			stopRingtone();
			hideFABBadge();
			startCallTimer();
			renderPhone();
		});

		session.on('confirmed', function () {
			state.callState = 'in_call';
			stopRingtone();
			hideFABBadge();
			attachRemoteAudio(session);
			renderPhone();
		});

		session.on('ended', function () {
			endCall();
		});

		session.on('failed', function (e) {
			console.log('Web Phone 2: Call failed/ended', e.cause);
			endCall();
		});

		// Handle remote stream via peerconnection
		session.on('peerconnection', function (data) {
			data.peerconnection.ontrack = function (event) {
				if (event.streams && event.streams[0]) {
					state.remoteAudio.srcObject = event.streams[0];
					state.remoteAudio.play().catch(function () {});
				}
			};
		});
	}

	function attachRemoteAudio(session) {
		try {
			var pc = session.connection;
			if (!pc) return;

			var receivers = pc.getReceivers();
			if (receivers.length > 0) {
				var remoteStream = new MediaStream();
				receivers.forEach(function (receiver) {
					if (receiver.track) {
						remoteStream.addTrack(receiver.track);
					}
				});
				state.remoteAudio.srcObject = remoteStream;
				state.remoteAudio.play().catch(function () {});
			}
		} catch (e) {}
	}

	// --- Browser Notifications ---

	function showIncomingNotification(session) {
		if (!('Notification' in window) || Notification.permission !== 'granted') return;

		closeIncomingNotification();

		var caller = 'Unknown';
		try {
			var remote = session.remote_identity;
			if (remote) {
				var name = remote.display_name || '';
				var num = remote.uri ? remote.uri.user : '';
				caller = name ? name + ' (' + num + ')' : (num || 'Unknown');
			}
		} catch (e) {}

		var extLabel = state.selectedExtension ? state.selectedExtension.extension : '';

		try {
			state.incomingNotification = new Notification('Incoming Call', {
				body: caller + (extLabel ? '\nTo: Extension ' + extLabel : ''),
				icon: '/app/web_phone2/resources/images/phone-icon.svg',
				tag: 'web-phone2-incoming-call',
				requireInteraction: true,
				silent: false
			});

			state.incomingNotification.onclick = function () {
				// Focus the browser window and answer
				window.focus();
				showPanel();
				answerCall();
				closeIncomingNotification();
			};

			state.incomingNotification.onclose = function () {
				state.incomingNotification = null;
			};
		} catch (e) {
			console.error('Web Phone 2: Notification error', e);
		}
	}

	function closeIncomingNotification() {
		if (state.incomingNotification) {
			try { state.incomingNotification.close(); } catch (e) {}
			state.incomingNotification = null;
		}
	}

	function endCall() {
		state.currentSession = null;
		state.callState = 'idle';
		state.muted = false;
		state.held = false;
		stopCallTimer();
		stopRingtone();
		hideFABBadge();
		closeIncomingNotification();
		if (state.remoteAudio) {
			state.remoteAudio.srcObject = null;
		}
		renderPhone();
	}

	// --- Call Timer ---

	function startCallTimer() {
		state.callDuration = 0;
		stopCallTimer();
		state.callTimer = setInterval(function () {
			state.callDuration++;
			var timerEl = document.getElementById('web-phone2-call-timer');
			if (timerEl) {
				timerEl.textContent = formatDuration(state.callDuration);
			}
		}, 1000);
	}

	function stopCallTimer() {
		if (state.callTimer) {
			clearInterval(state.callTimer);
			state.callTimer = null;
		}
		state.callDuration = 0;
	}

	function formatDuration(seconds) {
		var h = Math.floor(seconds / 3600);
		var m = Math.floor((seconds % 3600) / 60);
		var s = seconds % 60;
		var result = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
		if (h > 0) {
			result = (h < 10 ? '0' : '') + h + ':' + result;
		}
		return result;
	}

	// --- Ringtone ---

	function playRingtone() {
		try { state.ringtoneAudio.play().catch(function () {}); } catch (e) {}
	}

	function stopRingtone() {
		try {
			state.ringtoneAudio.pause();
			state.ringtoneAudio.currentTime = 0;
		} catch (e) {}
	}

	function generateRingtoneDataURI() {
		var sampleRate = 8000;
		var duration = 2.0;
		var samples = Math.floor(sampleRate * duration);
		var buffer = new ArrayBuffer(44 + samples * 2);
		var view = new DataView(buffer);

		// WAV header
		writeString(view, 0, 'RIFF');
		view.setUint32(4, 36 + samples * 2, true);
		writeString(view, 8, 'WAVE');
		writeString(view, 12, 'fmt ');
		view.setUint32(16, 16, true);
		view.setUint16(20, 1, true);
		view.setUint16(22, 1, true);
		view.setUint32(24, sampleRate, true);
		view.setUint32(28, sampleRate * 2, true);
		view.setUint16(32, 2, true);
		view.setUint16(34, 16, true);
		writeString(view, 36, 'data');
		view.setUint32(40, samples * 2, true);

		// US ringtone pattern: 440+480Hz for 2s on, 4s off (we just do the on part)
		for (var i = 0; i < samples; i++) {
			var t = i / sampleRate;
			var val = 0;
			// Ring: 0-0.5s tone, 0.5-0.8s silence, 0.8-1.3s tone, 1.3-2.0s silence
			if (t < 0.5 || (t >= 0.8 && t < 1.3)) {
				val = (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 480 * t)) * 0.25;
			}
			view.setInt16(44 + i * 2, val * 32767, true);
		}

		var blob = new Blob([buffer], { type: 'audio/wav' });
		return URL.createObjectURL(blob);
	}

	function writeString(view, offset, string) {
		for (var i = 0; i < string.length; i++) {
			view.setUint8(offset + i, string.charCodeAt(i));
		}
	}

	// --- UI Rendering ---

	function renderExtensionSelector() {
		if (!state.mountEl) return;
		var html = '<div class="web-phone2-inner">';
		html += '<div class="web-phone2-header">';
		html += '<span class="web-phone2-title">Web Phone 2</span>';
		html += '<button class="web-phone2-close-btn" onclick="WebPhone2.toggle()" title="Close">&times;</button>';
		html += '</div>';
		html += '<div class="web-phone2-body web-phone2-ext-selector">';
		html += '<label for="web-phone2-ext-select">Select Extension:</label>';
		html += '<select id="web-phone2-ext-select" class="web-phone2-select">';
		html += '<option value="">-- Choose Extension --</option>';
		for (var i = 0; i < state.extensions.length; i++) {
			var ext = state.extensions[i];
			var label = ext.extension;
			if (ext.description) label += ' - ' + ext.description;
			if (ext.caller_id_name && ext.caller_id_name !== ext.extension) {
				label += ' (' + ext.caller_id_name + ')';
			}
			html += '<option value="' + i + '">' + escapeHtml(label) + '</option>';
		}
		html += '</select>';
		html += '<button class="web-phone2-btn web-phone2-btn-primary" onclick="WebPhone2.selectExtension()">Connect</button>';
		html += '</div>';
		html += '</div>';
		state.mountEl.innerHTML = html;
	}

	function selectExtension() {
		var sel = document.getElementById('web-phone2-ext-select');
		if (!sel || sel.value === '') return;
		state.selectedExtension = state.extensions[parseInt(sel.value)];
		renderPhone();
		registerSIP();
	}

	function renderPhone() {
		if (!state.mountEl || !state.selectedExtension) return;

		var ext = state.selectedExtension;
		var html = '<div class="web-phone2-inner">';

		// Header
		html += '<div class="web-phone2-header">';
		html += '<span class="web-phone2-title">' + escapeHtml(ext.extension);
		if (ext.caller_id_name && ext.caller_id_name !== ext.extension) {
			html += ' <small>(' + escapeHtml(ext.caller_id_name) + ')</small>';
		}
		html += '</span>';
		html += '<span id="web-phone2-status" class="web-phone2-status web-phone2-status-' + (state.registered ? 'registered' : 'connecting') + '">';
		html += state.registered ? 'Registered' : 'Connecting...';
		html += '</span>';
		html += '<button class="web-phone2-close-btn" onclick="WebPhone2.toggle()" title="Minimize">&times;</button>';
		html += '</div>';

		// Body
		html += '<div class="web-phone2-body">';

		// Extension switcher (if multiple extensions)
		if (state.extensions.length > 1) {
			html += '<div class="web-phone2-ext-switch">';
			html += '<select id="web-phone2-ext-switch-select" class="web-phone2-select web-phone2-select-sm" onchange="WebPhone2.switchExtension(this.value)">';
			for (var i = 0; i < state.extensions.length; i++) {
				var e = state.extensions[i];
				var selected = (e.extension === ext.extension) ? ' selected' : '';
				var lbl = e.extension;
				if (e.description) lbl += ' - ' + e.description;
				html += '<option value="' + i + '"' + selected + '>' + escapeHtml(lbl) + '</option>';
			}
			html += '</select>';
			html += '</div>';
		}

		if (state.callState === 'idle') {
			html += renderDialPad();
		} else if (state.callState === 'ringing_in') {
			html += '<div class="web-phone2-call-info">';
			html += '<div class="web-phone2-call-icon web-phone2-call-icon-incoming">&#9742;</div>';
			html += '<div class="web-phone2-call-label">Incoming Call</div>';
			html += '<div class="web-phone2-call-number">' + getRemoteIdentity() + '</div>';
			html += '<div class="web-phone2-call-actions">';
			html += '<button class="web-phone2-btn web-phone2-btn-answer" onclick="WebPhone2.answer()">Answer</button>';
			html += '<button class="web-phone2-btn web-phone2-btn-reject" onclick="WebPhone2.reject()">Reject</button>';
			html += '</div>';
			html += '</div>';
		} else if (state.callState === 'ringing_out') {
			html += '<div class="web-phone2-call-info">';
			html += '<div class="web-phone2-call-icon">&#9742;</div>';
			html += '<div class="web-phone2-call-label">Calling...</div>';
			html += '<div class="web-phone2-call-number">' + escapeHtml(state.dialInput) + '</div>';
			html += '<div class="web-phone2-call-actions">';
			html += '<button class="web-phone2-btn web-phone2-btn-hangup" onclick="WebPhone2.hangup()">Cancel</button>';
			html += '</div>';
			html += '</div>';
		} else if (state.callState === 'in_call') {
			html += '<div class="web-phone2-call-info">';
			html += '<div class="web-phone2-call-icon web-phone2-call-icon-active">&#9742;</div>';
			html += '<div class="web-phone2-call-label">In Call</div>';
			html += '<div class="web-phone2-call-number">' + getRemoteIdentity() + '</div>';
			html += '<div id="web-phone2-call-timer" class="web-phone2-call-timer">' + formatDuration(state.callDuration) + '</div>';
			html += '<div class="web-phone2-call-actions">';
			html += '<button class="web-phone2-btn web-phone2-btn-sm ' + (state.muted ? 'web-phone2-btn-active' : '') + '" onclick="WebPhone2.toggleMute()">';
			html += state.muted ? 'Unmute' : 'Mute';
			html += '</button>';
			html += '<button class="web-phone2-btn web-phone2-btn-sm ' + (state.held ? 'web-phone2-btn-active' : '') + '" onclick="WebPhone2.toggleHold()">';
			html += state.held ? 'Resume' : 'Hold';
			html += '</button>';
			html += '<button class="web-phone2-btn web-phone2-btn-hangup" onclick="WebPhone2.hangup()">Hang Up</button>';
			html += '</div>';
			// In-call DTMF keypad
			html += renderInCallDTMF();
			// Transfer
			html += '<div class="web-phone2-transfer">';
			html += '<input type="text" id="web-phone2-transfer-input" class="web-phone2-input web-phone2-input-sm" placeholder="Transfer to...">';
			html += '<button class="web-phone2-btn web-phone2-btn-sm web-phone2-btn-primary" onclick="WebPhone2.transfer()">Xfer</button>';
			html += '</div>';
			html += '</div>';
		}

		html += '</div>'; // body
		html += '</div>'; // inner

		state.mountEl.innerHTML = html;

		// Restore dial input value
		var dialEl = document.getElementById('web-phone2-dial-input');
		if (dialEl && state.dialInput && state.callState === 'idle') {
			dialEl.value = state.dialInput;
		}
	}

	function renderDialPad() {
		var html = '<div class="web-phone2-dialpad">';
		html += '<input type="text" id="web-phone2-dial-input" class="web-phone2-input" placeholder="Enter number..." value="' + escapeHtml(state.dialInput) + '" onkeydown="if(event.key===\'Enter\')WebPhone2.call()" oninput="WebPhone2.updateDialInput(this.value)">';
		html += '<div class="web-phone2-dialpad-grid">';
		var keys = [
			{ key: '1', sub: '' },
			{ key: '2', sub: 'ABC' },
			{ key: '3', sub: 'DEF' },
			{ key: '4', sub: 'GHI' },
			{ key: '5', sub: 'JKL' },
			{ key: '6', sub: 'MNO' },
			{ key: '7', sub: 'PQRS' },
			{ key: '8', sub: 'TUV' },
			{ key: '9', sub: 'WXYZ' },
			{ key: '*', sub: '' },
			{ key: '0', sub: '+' },
			{ key: '#', sub: '' }
		];
		for (var i = 0; i < keys.length; i++) {
			html += '<button class="web-phone2-key" onclick="WebPhone2.pressKey(\'' + keys[i].key + '\')">';
			html += '<span class="web-phone2-key-main">' + keys[i].key + '</span>';
			if (keys[i].sub) {
				html += '<span class="web-phone2-key-sub">' + keys[i].sub + '</span>';
			}
			html += '</button>';
		}
		html += '</div>';
		html += '<div class="web-phone2-dial-actions">';
		html += '<button class="web-phone2-btn web-phone2-btn-call" onclick="WebPhone2.call()" ' + (!state.registered ? 'disabled title="Not registered"' : '') + '>';
		html += '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/></svg>';
		html += ' Call';
		html += '</button>';
		html += '<button class="web-phone2-btn web-phone2-btn-backspace" onclick="WebPhone2.backspace()" title="Backspace">';
		html += '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>';
		html += '</button>';
		html += '</div>';
		html += '</div>';
		return html;
	}

	function renderInCallDTMF() {
		var html = '<div class="web-phone2-incall-dtmf">';
		html += '<div class="web-phone2-dialpad-grid web-phone2-dialpad-sm">';
		var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
		for (var i = 0; i < keys.length; i++) {
			html += '<button class="web-phone2-key web-phone2-key-sm" onclick="WebPhone2.dtmf(\'' + keys[i] + '\')">' + keys[i] + '</button>';
		}
		html += '</div>';
		html += '</div>';
		return html;
	}

	function renderError(message) {
		if (!state.mountEl) return;
		var html = '<div class="web-phone2-inner">';
		html += '<div class="web-phone2-header">';
		html += '<span class="web-phone2-title">Web Phone 2</span>';
		html += '<button class="web-phone2-close-btn" onclick="WebPhone2.toggle()" title="Close">&times;</button>';
		html += '</div>';
		html += '<div class="web-phone2-body">';
		html += '<div class="web-phone2-error">' + escapeHtml(message) + '</div>';
		html += '</div>';
		html += '</div>';
		state.mountEl.innerHTML = html;
	}

	function getRemoteIdentity() {
		if (!state.currentSession) return 'Unknown';
		try {
			var remote = state.currentSession.remote_identity;
			if (remote) {
				var name = remote.display_name || '';
				var num = remote.uri ? remote.uri.user : '';
				if (name && num) return escapeHtml(name + ' <' + num + '>');
				if (num) return escapeHtml(num);
				if (name) return escapeHtml(name);
			}
		} catch (e) {}
		return escapeHtml(state.dialInput || 'Unknown');
	}

	function updateStatus(status) {
		var el = document.getElementById('web-phone2-status');
		if (!el) {
			renderPhone();
			return;
		}
		el.className = 'web-phone2-status web-phone2-status-' + status;
		switch (status) {
			case 'registered':
				el.textContent = 'Registered';
				break;
			case 'unregistered':
				el.textContent = 'Unregistered';
				break;
			case 'connecting':
				el.textContent = 'Connecting...';
				break;
			case 'error':
				el.textContent = 'Error';
				break;
		}
	}

	// --- FAB Badge ---

	function showFABBadge(text) {
		var badge = document.getElementById('web-phone2-fab-badge');
		if (badge) {
			badge.textContent = text;
			badge.classList.remove('hidden');
		}
	}

	function hideFABBadge() {
		var badge = document.getElementById('web-phone2-fab-badge');
		if (badge) {
			badge.classList.add('hidden');
		}
	}

	// --- Panel Toggle ---

	function toggle() {
		var panel = document.getElementById('web-phone2-panel');
		if (panel) {
			state.visible = !state.visible;
			if (state.visible) {
				panel.classList.remove('hidden');
			} else {
				panel.classList.add('hidden');
			}
		}
	}

	function showPanel() {
		var panel = document.getElementById('web-phone2-panel');
		if (panel) {
			state.visible = true;
			panel.classList.remove('hidden');
		}
	}

	// --- User Actions ---

	function pressKey(key) {
		state.dialInput += key;
		var dialEl = document.getElementById('web-phone2-dial-input');
		if (dialEl) {
			dialEl.value = state.dialInput;
			dialEl.focus();
		}
	}

	function backspace() {
		if (state.dialInput.length > 0) {
			state.dialInput = state.dialInput.slice(0, -1);
			var dialEl = document.getElementById('web-phone2-dial-input');
			if (dialEl) {
				dialEl.value = state.dialInput;
			}
		}
	}

	function updateDialInput(val) {
		state.dialInput = val;
	}

	function clearDial() {
		state.dialInput = '';
		var dialEl = document.getElementById('web-phone2-dial-input');
		if (dialEl) {
			dialEl.value = '';
		}
	}

	function call() {
		var dialEl = document.getElementById('web-phone2-dial-input');
		if (dialEl) {
			state.dialInput = dialEl.value.trim();
		}
		if (!state.dialInput) return;
		makeCall(state.dialInput);
	}

	function switchExtension(index) {
		index = parseInt(index);
		if (isNaN(index) || !state.extensions[index]) return;

		if (state.currentSession) {
			hangupCall();
		}
		unregisterSIP();

		state.selectedExtension = state.extensions[index];
		renderPhone();
		registerSIP();
	}

	function transfer() {
		var input = document.getElementById('web-phone2-transfer-input');
		if (input && input.value.trim()) {
			transferCall(input.value.trim());
		}
	}

	// --- Helpers ---

	function escapeHtml(str) {
		if (!str) return '';
		var div = document.createElement('div');
		div.appendChild(document.createTextNode(str));
		return div.innerHTML;
	}

	// --- Public API ---

	return {
		init: init,
		toggle: toggle,
		selectExtension: selectExtension,
		switchExtension: switchExtension,
		pressKey: pressKey,
		backspace: backspace,
		updateDialInput: updateDialInput,
		clearDial: clearDial,
		call: call,
		answer: answerCall,
		reject: rejectCall,
		hangup: hangupCall,
		toggleMute: toggleMute,
		toggleHold: toggleHold,
		dtmf: sendDTMF,
		transfer: transfer
	};

})();
