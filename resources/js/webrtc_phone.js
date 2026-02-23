/*
	FusionPBX WebRTC Phone
	Browser-based SIP softphone using JsSIP over WebSocket Secure (WSS).
	Fetches the active user's extensions from FusionPBX and registers via WebRTC.
*/

var WebRTCPhone = (function () {
	'use strict';

	// Available ringtones
	var ringtones = [
		{ name: 'Classic US' },
		{ name: 'Classic Bell' },
		{ name: 'Digital Beep' },
		{ name: 'Soft Ring' },
		{ name: 'UK Ring' }
	];

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
		incomingNotification: null,
		// Audio settings
		audioSettings: {
			ringtoneIndex: 0,
			ringVolume: 0.7,
			speakerVolume: 1.0,
			ringDeviceId: 'default',
			speakerDeviceId: 'default',
			micDeviceId: 'default'
		},
		showSettings: false,
		audioDevices: { inputs: [], outputs: [] },
		previewingRingtone: false,
		previewTimeout: null
	};

	// --- Initialization ---

	function init(mountId) {
		if (state.initialized) return;
		state.mountEl = document.getElementById(mountId);
		if (!state.mountEl) return;

		loadAudioSettings();

		// Create hidden audio element for remote audio
		state.remoteAudio = document.createElement('audio');
		state.remoteAudio.id = 'webrtc-remote-audio';
		state.remoteAudio.autoplay = true;
		state.remoteAudio.volume = state.audioSettings.speakerVolume;
		document.body.appendChild(state.remoteAudio);

		// Create ringtone audio
		state.ringtoneAudio = document.createElement('audio');
		state.ringtoneAudio.id = 'webrtc-ringtone';
		state.ringtoneAudio.loop = true;
		state.ringtoneAudio.volume = state.audioSettings.ringVolume;
		state.ringtoneAudio.src = generateRingtoneByIndex(state.audioSettings.ringtoneIndex);
		document.body.appendChild(state.ringtoneAudio);

		applyOutputDevices();

		state.initialized = true;

		// Navigation guard: warn before leaving page or submitting forms during a call
		window.addEventListener('beforeunload', handleBeforeUnload);
		document.addEventListener('submit', handleFormSubmit, true);
		document.addEventListener('click', handleLinkClick, true);

		// Request notification permission early
		requestNotificationPermission();

		fetchConfig();
	}

	function requestNotificationPermission() {
		if (!('Notification' in window)) return;
		if (Notification.permission === 'default') {
			Notification.requestPermission().then(function (perm) {
				console.log('WebRTC Phone: Notification permission:', perm);
			});
		}
	}

	// --- Audio Settings ---

	function loadAudioSettings() {
		try {
			var saved = localStorage.getItem('webrtc_phone_audio_settings');
			if (saved) {
				var p = JSON.parse(saved);
				var idx = parseInt(p.ringtoneIndex);
				if (!isNaN(idx) && idx >= 0 && idx < ringtones.length) {
					state.audioSettings.ringtoneIndex = idx;
				}
				var rv = parseFloat(p.ringVolume);
				if (!isNaN(rv)) state.audioSettings.ringVolume = Math.max(0, Math.min(1, rv));
				var sv = parseFloat(p.speakerVolume);
				if (!isNaN(sv)) state.audioSettings.speakerVolume = Math.max(0, Math.min(1, sv));
				if (p.ringDeviceId) state.audioSettings.ringDeviceId = p.ringDeviceId;
				if (p.speakerDeviceId) state.audioSettings.speakerDeviceId = p.speakerDeviceId;
				if (p.micDeviceId) state.audioSettings.micDeviceId = p.micDeviceId;
			}
		} catch (e) {
			console.warn('WebRTC Phone: Failed to load audio settings', e);
		}
	}

	function saveAudioSettings() {
		try {
			localStorage.setItem('webrtc_phone_audio_settings', JSON.stringify(state.audioSettings));
		} catch (e) {
			console.warn('WebRTC Phone: Failed to save audio settings', e);
		}
	}

	function applyOutputDevices() {
		if (state.remoteAudio && typeof state.remoteAudio.setSinkId === 'function') {
			var sid = state.audioSettings.speakerDeviceId || 'default';
			state.remoteAudio.setSinkId(sid).catch(function () {});
		}
		if (state.ringtoneAudio && typeof state.ringtoneAudio.setSinkId === 'function') {
			var rid = state.audioSettings.ringDeviceId || 'default';
			state.ringtoneAudio.setSinkId(rid).catch(function () {});
		}
	}

	function enumerateAudioDevices(callback) {
		if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
			callback({ inputs: [], outputs: [] });
			return;
		}
		navigator.mediaDevices.enumerateDevices().then(function (devices) {
			var inputs = [];
			var outputs = [];
			devices.forEach(function (device) {
				if (device.kind === 'audioinput') {
					inputs.push({ id: device.deviceId, label: device.label || ('Microphone ' + (inputs.length + 1)) });
				} else if (device.kind === 'audiooutput') {
					outputs.push({ id: device.deviceId, label: device.label || ('Speaker ' + (outputs.length + 1)) });
				}
			});
			callback({ inputs: inputs, outputs: outputs });
		}).catch(function () {
			callback({ inputs: [], outputs: [] });
		});
	}

	function openSettings() {
		if (state.showSettings) {
			closeSettings();
			return;
		}
		state.showSettings = true;
		enumerateAudioDevices(function (devices) {
			state.audioDevices = devices;
			renderPhone();
		});
	}

	function closeSettings() {
		stopPreview();
		state.showSettings = false;
		renderPhone();
	}

	function setRingtone(index) {
		index = parseInt(index);
		if (isNaN(index) || index < 0 || index >= ringtones.length) return;
		stopPreview();
		state.audioSettings.ringtoneIndex = index;
		var oldSrc = state.ringtoneAudio.src;
		var newUrl = generateRingtoneByIndex(index);
		state.ringtoneAudio.src = newUrl;
		if (oldSrc && oldSrc.indexOf('blob:') === 0) {
			try { URL.revokeObjectURL(oldSrc); } catch (e) {}
		}
		saveAudioSettings();
	}

	function setRingVolume(vol) {
		vol = parseFloat(vol);
		if (isNaN(vol)) return;
		vol = Math.max(0, Math.min(1, vol));
		state.audioSettings.ringVolume = vol;
		if (state.ringtoneAudio) state.ringtoneAudio.volume = vol;
		saveAudioSettings();
	}

	function setSpeakerVolume(vol) {
		vol = parseFloat(vol);
		if (isNaN(vol)) return;
		vol = Math.max(0, Math.min(1, vol));
		state.audioSettings.speakerVolume = vol;
		if (state.remoteAudio) state.remoteAudio.volume = vol;
		saveAudioSettings();
	}

	function setRingDevice(deviceId) {
		state.audioSettings.ringDeviceId = deviceId;
		if (state.ringtoneAudio && typeof state.ringtoneAudio.setSinkId === 'function') {
			state.ringtoneAudio.setSinkId(deviceId || 'default').catch(function () {});
		}
		saveAudioSettings();
	}

	function setSpeakerDevice(deviceId) {
		state.audioSettings.speakerDeviceId = deviceId;
		if (state.remoteAudio && typeof state.remoteAudio.setSinkId === 'function') {
			state.remoteAudio.setSinkId(deviceId || 'default').catch(function () {});
		}
		saveAudioSettings();
	}

	function setMicDevice(deviceId) {
		state.audioSettings.micDeviceId = deviceId;
		saveAudioSettings();
	}

	function previewRingtone() {
		if (state.callState !== 'idle') return;
		if (state.previewingRingtone) {
			stopPreview();
		} else {
			state.previewingRingtone = true;
			state.ringtoneAudio.play().catch(function () {});
			var btn = document.getElementById('webrtc-preview-btn');
			if (btn) btn.textContent = 'Stop';
			state.previewTimeout = setTimeout(function () {
				stopPreview();
			}, 4000);
		}
	}

	function stopPreview() {
		if (state.previewTimeout) {
			clearTimeout(state.previewTimeout);
			state.previewTimeout = null;
		}
		if (state.previewingRingtone) {
			try {
				state.ringtoneAudio.pause();
				state.ringtoneAudio.currentTime = 0;
			} catch (e) {}
			state.previewingRingtone = false;
			var btn = document.getElementById('webrtc-preview-btn');
			if (btn) btn.textContent = 'Preview';
		}
	}

	function getMicConstraints() {
		var micId = state.audioSettings.micDeviceId;
		if (micId && micId !== 'default') {
			return { audio: { deviceId: { exact: micId } }, video: false };
		}
		return { audio: true, video: false };
	}

	// --- Navigation Guard (prevent call drop on page change / form submit) ---

	function isCallActive() {
		return state.callState === 'in_call' ||
			state.callState === 'ringing_in' ||
			state.callState === 'ringing_out';
	}

	function handleBeforeUnload(e) {
		if (!isCallActive()) return;
		e.preventDefault();
		e.returnValue = '';
		return '';
	}

	function handleFormSubmit(e) {
		if (!isCallActive()) return;
		var form = e.target;
		// Allow the phone's own forms to submit without interception
		if (state.mountEl && state.mountEl.contains(form)) return;
		e.preventDefault();
		e.stopImmediatePropagation();
		showNavigationWarning(function () {
			hangupCall();
			setTimeout(function () { form.submit(); }, 250);
		});
	}

	function handleLinkClick(e) {
		if (!isCallActive()) return;
		var link = e.target.closest ? e.target.closest('a') : null;
		if (!link) {
			var el = e.target;
			while (el && el.tagName !== 'A') el = el.parentNode;
			link = el;
		}
		if (!link || !link.href) return;
		// Allow: new-tab links, javascript: pseudo-links, same-page hash anchors
		if (link.target === '_blank') return;
		if (link.href.indexOf('javascript:') === 0) return;
		var hrefBase = link.href.split('#')[0];
		var pageBase = window.location.href.split('#')[0];
		if (hrefBase === pageBase) return;
		// Allow clicks inside the phone widget itself
		if (state.mountEl && state.mountEl.contains(link)) return;
		var container = document.getElementById('webrtc-phone-floating-container');
		if (container && container.contains(link)) return;
		e.preventDefault();
		e.stopImmediatePropagation();
		var href = link.href;
		showNavigationWarning(function () {
			hangupCall();
			setTimeout(function () { window.location.href = href; }, 250);
		});
	}

	function showNavigationWarning(onConfirm) {
		closeNavigationWarning();
		var overlay = document.createElement('div');
		overlay.id = 'webrtc-nav-warning';
		overlay.style.cssText = [
			'position:fixed', 'top:0', 'left:0', 'right:0', 'bottom:0',
			'background:rgba(0,0,0,0.55)', 'z-index:2147483647',
			'display:flex', 'align-items:center', 'justify-content:center'
		].join(';');
		overlay.innerHTML =
			'<div style="background:#fff;border-radius:14px;padding:28px 24px;max-width:320px;width:90%;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,0.3);">' +
			'<div style="font-size:40px;margin-bottom:10px;">&#9742;</div>' +
			'<div style="font-weight:700;font-size:17px;margin-bottom:8px;color:#222;">Call in Progress</div>' +
			'<div style="font-size:13px;color:#555;margin-bottom:22px;line-height:1.5;">Leaving this page will end your current call.<br>Are you sure you want to continue?</div>' +
			'<div style="display:flex;gap:10px;justify-content:center;">' +
			'<button id="webrtc-nav-stay" style="flex:1;padding:10px 0;border:none;border-radius:8px;background:#e8eaed;color:#333;font-weight:600;cursor:pointer;font-size:14px;">Stay on Page</button>' +
			'<button id="webrtc-nav-leave" style="flex:1;padding:10px 0;border:none;border-radius:8px;background:#e53935;color:#fff;font-weight:600;cursor:pointer;font-size:14px;">End Call &amp; Leave</button>' +
			'</div></div>';
		document.body.appendChild(overlay);
		document.getElementById('webrtc-nav-stay').addEventListener('click', closeNavigationWarning);
		document.getElementById('webrtc-nav-leave').addEventListener('click', function () {
			closeNavigationWarning();
			onConfirm();
		});
		// Also close on backdrop click
		overlay.addEventListener('click', function (e) {
			if (e.target === overlay) closeNavigationWarning();
		});
	}

	function closeNavigationWarning() {
		var el = document.getElementById('webrtc-nav-warning');
		if (el && el.parentNode) el.parentNode.removeChild(el);
	}

	function fetchConfig() {
		var xhr = new XMLHttpRequest();
		xhr.open('GET', '/app/webrtc_phone/webrtc_phone_api.php', true);
		xhr.onreadystatechange = function () {
			if (xhr.readyState === 4) {
				if (xhr.status === 200) {
					try {
						var data = JSON.parse(xhr.responseText);
						if (data.error) { renderError(data.error); return; }
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

		var wssUrl = 'wss://' + domain + ':' + wssPort;
		var sipUri = 'sip:' + ext.extension + '@' + domain;

		JsSIP.debug.enable('JsSIP:*');
		console.log('WebRTC Phone: Connecting to', wssUrl, 'as', sipUri);
		updateStatus('connecting');

		try {
			var socket = new JsSIP.WebSocketInterface(wssUrl);
			var configuration = {
				sockets: [socket],
				uri: sipUri,
				password: ext.password,
				display_name: ext.caller_id_name || ext.extension,
				register: true,
				session_timers: false,
				user_agent: 'FusionPBX-WebRTC-Phone/1.0'
			};

			state.ua = new JsSIP.UA(configuration);

			state.ua.on('registered', function () { state.registered = true; renderPhone(); });
			state.ua.on('unregistered', function () { state.registered = false; renderPhone(); });
			state.ua.on('registrationFailed', function (e) {
				state.registered = false;
				console.error('WebRTC Phone: Registration failed', e.cause);
				renderPhone();
			});
			state.ua.on('newRTCSession', function (data) {
				console.log('WebRTC Phone: newRTCSession', data.originator, data.request ? data.request.method : '');
				if (data.originator === 'remote') handleIncomingCall(data.session);
			});
			state.ua.on('disconnected', function () { state.registered = false; renderPhone(); });
			state.ua.start();
		} catch (e) {
			console.error('WebRTC Phone: SIP registration error', e);
			updateStatus('error');
		}
	}

	function unregisterSIP() {
		if (state.ua) {
			try { state.ua.unregister({ all: true }); state.ua.stop(); } catch (e) {}
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
		console.log('WebRTC Phone: Calling', targetURI);

		var eventHandlers = {
			'peerconnection': function (data) {
				data.peerconnection.ontrack = function (event) {
					if (event.streams && event.streams[0]) {
						state.remoteAudio.srcObject = event.streams[0];
						state.remoteAudio.play().catch(function () {});
					}
				};
			},
			'accepted': function (data) {
				console.log('WebRTC Phone: call accepted', data);
				state.callState = 'in_call'; stopRingtone(); hideFABBadge(); startCallTimer(); renderPhone();
			},
			'confirmed': function (data) {
				console.log('WebRTC Phone: call confirmed', data);
				state.callState = 'in_call'; stopRingtone(); hideFABBadge(); renderPhone();
			},
			'ended': function (data) { console.log('WebRTC Phone: call ended', data.cause); endCall(); },
			'failed': function (data) { console.error('WebRTC Phone: call failed', data.cause); endCall(); },
			'getusermediafailed': function (data) { console.error('WebRTC Phone: getUserMedia failed', data); endCall(); }
		};

		var options = {
			eventHandlers: eventHandlers,
			mediaConstraints: getMicConstraints(),
			pcConfig: { iceServers: getICEServers() },
			rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false }
		};

		try {
			state.currentSession = state.ua.call(targetURI, options);
			state.callState = 'ringing_out';
			state.muted = false;
			state.held = false;
			renderPhone();
		} catch (e) {
			console.error('WebRTC Phone: Call exception', e);
			endCall();
		}
	}

	function handleIncomingCall(session) {
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
		stopRingtone(); hideFABBadge(); closeIncomingNotification();
		var options = { mediaConstraints: getMicConstraints(), pcConfig: { iceServers: getICEServers() } };
		try {
			state.currentSession.answer(options);
		} catch (e) {
			console.error('WebRTC Phone: Answer failed', e);
			endCall();
		}
	}

	function rejectCall() {
		if (!state.currentSession || state.callState !== 'ringing_in') return;
		stopRingtone(); hideFABBadge(); closeIncomingNotification();
		try { state.currentSession.terminate({ status_code: 486, reason_phrase: 'Busy Here' }); } catch (e) {}
		endCall();
	}

	function hangupCall() {
		if (!state.currentSession) return;
		stopRingtone(); hideFABBadge();
		try { state.currentSession.terminate(); } catch (e) {}
		endCall();
	}

	function toggleMute() {
		if (!state.currentSession || state.callState !== 'in_call') return;
		state.muted = !state.muted;
		if (state.muted) { state.currentSession.mute({ audio: true }); }
		else { state.currentSession.unmute({ audio: true }); }
		renderPhone();
	}

	function toggleHold() {
		if (!state.currentSession || state.callState !== 'in_call') return;
		state.held = !state.held;
		try {
			if (state.held) { state.currentSession.hold(); } else { state.currentSession.unhold(); }
		} catch (e) { state.held = !state.held; }
		renderPhone();
	}

	function sendDTMF(tone) {
		if (!state.currentSession || state.callState !== 'in_call') return;
		try {
			state.currentSession.sendDTMF(tone, { duration: 100, interToneGap: 50, transportType: 'RFC2833' });
		} catch (e) {
			try { state.currentSession.sendDTMF(tone, { duration: 100, interToneGap: 50 }); } catch (e2) {}
		}
	}

	function transferCall(target) {
		if (!state.currentSession || state.callState !== 'in_call' || !target) return;
		var targetURI = 'sip:' + target + '@' + state.config.domain;
		try { state.currentSession.refer(targetURI); } catch (e) {}
	}

	function setupSessionListeners(session) {
		session.on('accepted', function () {
			state.callState = 'in_call'; stopRingtone(); hideFABBadge(); startCallTimer(); renderPhone();
		});
		session.on('confirmed', function () {
			state.callState = 'in_call'; stopRingtone(); hideFABBadge(); attachRemoteAudio(session); renderPhone();
		});
		session.on('ended', function () { endCall(); });
		session.on('failed', function (e) { console.log('WebRTC Phone: Call failed/ended', e.cause); endCall(); });
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
				receivers.forEach(function (receiver) { if (receiver.track) remoteStream.addTrack(receiver.track); });
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
				icon: '/app/webrtc_phone/resources/images/phone-icon.svg',
				tag: 'webrtc-incoming-call',
				requireInteraction: true,
				silent: false
			});
			state.incomingNotification.onclick = function () {
				window.focus(); showPanel(); answerCall(); closeIncomingNotification();
			};
			state.incomingNotification.onclose = function () { state.incomingNotification = null; };
		} catch (e) {}
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
		stopCallTimer(); stopRingtone(); hideFABBadge(); closeIncomingNotification();
		if (state.remoteAudio) state.remoteAudio.srcObject = null;
		renderPhone();
	}

	// --- Call Timer ---

	function startCallTimer() {
		state.callDuration = 0;
		stopCallTimer();
		state.callTimer = setInterval(function () {
			state.callDuration++;
			var timerEl = document.getElementById('webrtc-call-timer');
			if (timerEl) timerEl.textContent = formatDuration(state.callDuration);
		}, 1000);
	}

	function stopCallTimer() {
		if (state.callTimer) { clearInterval(state.callTimer); state.callTimer = null; }
		state.callDuration = 0;
	}

	function formatDuration(seconds) {
		var h = Math.floor(seconds / 3600);
		var m = Math.floor((seconds % 3600) / 60);
		var s = seconds % 60;
		var result = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
		if (h > 0) result = (h < 10 ? '0' : '') + h + ':' + result;
		return result;
	}

	// --- Ringtone Playback ---

	function playRingtone() {
		try { state.ringtoneAudio.play().catch(function () {}); } catch (e) {}
	}

	function stopRingtone() {
		try { state.ringtoneAudio.pause(); state.ringtoneAudio.currentTime = 0; } catch (e) {}
		stopPreview();
	}

	// --- Ringtone Generators ---

	function generateRingtoneByIndex(index) {
		switch (index) {
			case 1: return generateBellRingtone();
			case 2: return generateDigitalRingtone();
			case 3: return generateSoftRingtone();
			case 4: return generateUKRingtone();
			default: return generateUSRingtone();
		}
	}

	function createWAVObjectURL(sampleRate, samples) {
		var n = samples.length;
		var buffer = new ArrayBuffer(44 + n * 2);
		var view = new DataView(buffer);
		writeString(view, 0, 'RIFF');
		view.setUint32(4, 36 + n * 2, true);
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
		view.setUint32(40, n * 2, true);
		for (var i = 0; i < n; i++) {
			var val = Math.max(-1, Math.min(1, samples[i]));
			view.setInt16(44 + i * 2, Math.round(val * 32767), true);
		}
		var blob = new Blob([buffer], { type: 'audio/wav' });
		return URL.createObjectURL(blob);
	}

	function generateUSRingtone() {
		var sr = 8000, n = Math.floor(sr * 2.0), s = new Float32Array(n);
		for (var i = 0; i < n; i++) {
			var t = i / sr;
			if (t < 0.5 || (t >= 0.8 && t < 1.3))
				s[i] = (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 480 * t)) * 0.25;
		}
		return createWAVObjectURL(sr, s);
	}

	function generateBellRingtone() {
		var sr = 8000, n = Math.floor(sr * 2.0), s = new Float32Array(n);
		var bellTimes = [0.0, 1.0];
		for (var i = 0; i < n; i++) {
			var t = i / sr, val = 0;
			for (var b = 0; b < bellTimes.length; b++) {
				var t0 = bellTimes[b];
				if (t >= t0 && t < t0 + 0.85) {
					var dt = t - t0, env = Math.exp(-4.5 * dt);
					val += env * (Math.sin(2 * Math.PI * 880 * t) * 0.30 +
						Math.sin(2 * Math.PI * 1760 * t) * 0.15 +
						Math.sin(2 * Math.PI * 2640 * t) * 0.05);
				}
			}
			s[i] = Math.max(-1, Math.min(1, val));
		}
		return createWAVObjectURL(sr, s);
	}

	function generateDigitalRingtone() {
		var sr = 8000, n = Math.floor(sr * 2.0), s = new Float32Array(n);
		var beeps = [[0.0, 0.08], [0.15, 0.23], [0.30, 0.38]];
		for (var i = 0; i < n; i++) {
			var t = i / sr, inBeep = false;
			for (var b = 0; b < beeps.length; b++) {
				if (t >= beeps[b][0] && t < beeps[b][1]) { inBeep = true; break; }
			}
			if (inBeep) s[i] = Math.sin(2 * Math.PI * 900 * t) * 0.40;
		}
		return createWAVObjectURL(sr, s);
	}

	function generateSoftRingtone() {
		var sr = 8000, n = Math.floor(sr * 2.0), s = new Float32Array(n);
		var rings = [[0.0, 0.55], [0.85, 1.4]], fadeTime = 0.05;
		for (var i = 0; i < n; i++) {
			var t = i / sr, val = 0;
			for (var r = 0; r < rings.length; r++) {
				var t0 = rings[r][0], t1 = rings[r][1];
				if (t >= t0 && t < t1) {
					var dt = t - t0, rd = t1 - t0;
					var env = (dt < fadeTime) ? dt / fadeTime : (dt > rd - fadeTime) ? (rd - dt) / fadeTime : 1;
					val = env * (Math.sin(2 * Math.PI * 350 * t) + Math.sin(2 * Math.PI * 440 * t)) * 0.20;
				}
			}
			s[i] = val;
		}
		return createWAVObjectURL(sr, s);
	}

	function generateUKRingtone() {
		var sr = 8000, n = Math.floor(sr * 2.0), s = new Float32Array(n);
		for (var i = 0; i < n; i++) {
			var t = i / sr;
			if (t < 0.4 || (t >= 0.6 && t < 1.0))
				s[i] = (Math.sin(2 * Math.PI * 400 * t) + Math.sin(2 * Math.PI * 450 * t)) * 0.25;
		}
		return createWAVObjectURL(sr, s);
	}

	function writeString(view, offset, string) {
		for (var i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
	}

	// --- UI Rendering ---

	function renderExtensionSelector() {
		if (!state.mountEl) return;
		var html = '<div class="webrtc-phone-inner">';
		html += '<div class="webrtc-phone-header">';
		html += '<span class="webrtc-phone-title">WebRTC Phone</span>';
		html += '<button class="webrtc-close-btn" onclick="WebRTCPhone.toggle()" title="Close">&times;</button>';
		html += '</div>';
		html += '<div class="webrtc-phone-body webrtc-ext-selector">';
		html += '<label for="webrtc-ext-select">Select Extension:</label>';
		html += '<select id="webrtc-ext-select" class="webrtc-select">';
		html += '<option value="">-- Choose Extension --</option>';
		for (var i = 0; i < state.extensions.length; i++) {
			var ext = state.extensions[i];
			var label = ext.extension;
			if (ext.description) label += ' - ' + ext.description;
			if (ext.caller_id_name && ext.caller_id_name !== ext.extension) label += ' (' + ext.caller_id_name + ')';
			html += '<option value="' + i + '">' + escapeHtml(label) + '</option>';
		}
		html += '</select>';
		html += '<button class="webrtc-btn webrtc-btn-primary" onclick="WebRTCPhone.selectExtension()">Connect</button>';
		html += '</div></div>';
		state.mountEl.innerHTML = html;
	}

	function selectExtension() {
		var sel = document.getElementById('webrtc-ext-select');
		if (!sel || sel.value === '') return;
		state.selectedExtension = state.extensions[parseInt(sel.value)];
		renderPhone(); registerSIP();
	}

	function renderPhone() {
		if (!state.mountEl || !state.selectedExtension) return;

		var ext = state.selectedExtension;
		var html = '<div class="webrtc-phone-inner">';

		// Header
		html += '<div class="webrtc-phone-header">';
		html += '<span class="webrtc-phone-title">' + escapeHtml(ext.extension);
		if (ext.caller_id_name && ext.caller_id_name !== ext.extension)
			html += ' <small>(' + escapeHtml(ext.caller_id_name) + ')</small>';
		html += '</span>';
		html += '<span id="webrtc-status" class="webrtc-status webrtc-status-' + (state.registered ? 'registered' : 'connecting') + '">';
		html += state.registered ? 'Registered' : 'Connecting...';
		html += '</span>';
		html += '<button class="webrtc-settings-btn' + (state.showSettings ? ' webrtc-settings-btn-active' : '') + '" onclick="WebRTCPhone.openSettings()" title="Audio Settings">';
		html += '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor">';
		html += '<path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.63-.07.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>';
		html += '</svg></button>';
		html += '<button class="webrtc-close-btn" onclick="WebRTCPhone.toggle()" title="Minimize">&times;</button>';
		html += '</div>';

		html += '<div class="webrtc-phone-body">';

		if (state.showSettings) {
			html += renderSettingsPanel();
		} else {
			if (state.extensions.length > 1) {
				html += '<div class="webrtc-ext-switch">';
				html += '<select id="webrtc-ext-switch-select" class="webrtc-select webrtc-select-sm" onchange="WebRTCPhone.switchExtension(this.value)">';
				for (var i = 0; i < state.extensions.length; i++) {
					var e = state.extensions[i];
					var selected = (e.extension === ext.extension) ? ' selected' : '';
					var lbl = e.extension;
					if (e.description) lbl += ' - ' + e.description;
					html += '<option value="' + i + '"' + selected + '>' + escapeHtml(lbl) + '</option>';
				}
				html += '</select></div>';
			}

			if (state.callState === 'idle') {
				html += renderDialPad();
			} else if (state.callState === 'ringing_in') {
				html += '<div class="webrtc-call-info">';
				html += '<div class="webrtc-call-icon webrtc-call-icon-incoming">&#9742;</div>';
				html += '<div class="webrtc-call-label">Incoming Call</div>';
				html += '<div class="webrtc-call-number">' + getRemoteIdentity() + '</div>';
				html += '<div class="webrtc-call-actions">';
				html += '<button class="webrtc-btn webrtc-btn-answer" onclick="WebRTCPhone.answer()">Answer</button>';
				html += '<button class="webrtc-btn webrtc-btn-reject" onclick="WebRTCPhone.reject()">Reject</button>';
				html += '</div></div>';
			} else if (state.callState === 'ringing_out') {
				html += '<div class="webrtc-call-info">';
				html += '<div class="webrtc-call-icon">&#9742;</div>';
				html += '<div class="webrtc-call-label">Calling...</div>';
				html += '<div class="webrtc-call-number">' + escapeHtml(state.dialInput) + '</div>';
				html += '<div class="webrtc-call-actions">';
				html += '<button class="webrtc-btn webrtc-btn-hangup" onclick="WebRTCPhone.hangup()">Cancel</button>';
				html += '</div></div>';
			} else if (state.callState === 'in_call') {
				html += '<div class="webrtc-call-info">';
				html += '<div class="webrtc-call-icon webrtc-call-icon-active">&#9742;</div>';
				html += '<div class="webrtc-call-label">In Call</div>';
				html += '<div class="webrtc-call-number">' + getRemoteIdentity() + '</div>';
				html += '<div id="webrtc-call-timer" class="webrtc-call-timer">' + formatDuration(state.callDuration) + '</div>';
				html += '<div class="webrtc-call-actions">';
				html += '<button class="webrtc-btn webrtc-btn-sm ' + (state.muted ? 'webrtc-btn-active' : '') + '" onclick="WebRTCPhone.toggleMute()">' + (state.muted ? 'Unmute' : 'Mute') + '</button>';
				html += '<button class="webrtc-btn webrtc-btn-sm ' + (state.held ? 'webrtc-btn-active' : '') + '" onclick="WebRTCPhone.toggleHold()">' + (state.held ? 'Resume' : 'Hold') + '</button>';
				html += '<button class="webrtc-btn webrtc-btn-hangup" onclick="WebRTCPhone.hangup()">Hang Up</button>';
				html += '</div>';
				html += renderInCallDTMF();
				html += '<div class="webrtc-transfer">';
				html += '<input type="text" id="webrtc-transfer-input" class="webrtc-input webrtc-input-sm" placeholder="Transfer to...">';
				html += '<button class="webrtc-btn webrtc-btn-sm webrtc-btn-primary" onclick="WebRTCPhone.transfer()">Xfer</button>';
				html += '</div></div>';
			}
		}

		html += '</div></div>';
		state.mountEl.innerHTML = html;

		var dialEl = document.getElementById('webrtc-dial-input');
		if (dialEl && state.dialInput && state.callState === 'idle') dialEl.value = state.dialInput;
	}

	function renderSettingsPanel() {
		var as = state.audioSettings;
		var devices = state.audioDevices;
		var sinkIdSupported = typeof (document.createElement('audio').setSinkId) === 'function';
		var ringVolPct = Math.round(as.ringVolume * 100);
		var spkVolPct = Math.round(as.speakerVolume * 100);

		var html = '<div class="webrtc-settings-panel">';

		html += '<div class="webrtc-settings-section">';
		html += '<div class="webrtc-settings-title">&#127925; Ringtone</div>';
		html += '<div class="webrtc-settings-row">';
		html += '<select class="webrtc-select webrtc-select-sm" style="flex:1" onchange="WebRTCPhone.setRingtone(this.value)">';
		for (var i = 0; i < ringtones.length; i++) {
			html += '<option value="' + i + '"' + (i === as.ringtoneIndex ? ' selected' : '') + '>' + escapeHtml(ringtones[i].name) + '</option>';
		}
		html += '</select>';
		html += '<button id="webrtc-preview-btn" class="webrtc-btn webrtc-btn-sm webrtc-btn-secondary" onclick="WebRTCPhone.previewRingtone()">' + (state.previewingRingtone ? 'Stop' : 'Preview') + '</button>';
		html += '</div>';
		html += '<div class="webrtc-volume-row">';
		html += '<span class="webrtc-volume-label">Ring Vol</span>';
		html += '<input type="range" class="webrtc-volume-slider" min="0" max="1" step="0.05" value="' + as.ringVolume + '" oninput="document.getElementById(\'webrtc-ring-vol-pct\').textContent=Math.round(this.value*100)+\'%\';WebRTCPhone.setRingVolume(this.value)">';
		html += '<span id="webrtc-ring-vol-pct" class="webrtc-volume-pct">' + ringVolPct + '%</span>';
		html += '</div></div>';

		html += '<div class="webrtc-settings-section">';
		html += '<div class="webrtc-settings-title">&#128276; Ring Device</div>';
		if (sinkIdSupported) {
			html += '<select class="webrtc-select webrtc-select-sm" onchange="WebRTCPhone.setRingDevice(this.value)">';
			html += '<option value="default"' + (as.ringDeviceId === 'default' ? ' selected' : '') + '>Default</option>';
			for (var j = 0; j < devices.outputs.length; j++) {
				var dj = devices.outputs[j];
				html += '<option value="' + escapeHtml(dj.id) + '"' + (dj.id === as.ringDeviceId ? ' selected' : '') + '>' + escapeHtml(dj.label) + '</option>';
			}
			html += '</select>';
			if (devices.outputs.length === 0) html += '<div class="webrtc-settings-note">No output devices found.</div>';
		} else {
			html += '<div class="webrtc-settings-note">Requires Chrome or Edge for device selection.</div>';
		}
		html += '</div>';

		html += '<div class="webrtc-settings-section">';
		html += '<div class="webrtc-settings-title">&#128266; Speaker</div>';
		if (sinkIdSupported) {
			html += '<select class="webrtc-select webrtc-select-sm" onchange="WebRTCPhone.setSpeakerDevice(this.value)">';
			html += '<option value="default"' + (as.speakerDeviceId === 'default' ? ' selected' : '') + '>Default</option>';
			for (var k = 0; k < devices.outputs.length; k++) {
				var dk = devices.outputs[k];
				html += '<option value="' + escapeHtml(dk.id) + '"' + (dk.id === as.speakerDeviceId ? ' selected' : '') + '>' + escapeHtml(dk.label) + '</option>';
			}
			html += '</select>';
		}
		html += '<div class="webrtc-volume-row">';
		html += '<span class="webrtc-volume-label">Volume</span>';
		html += '<input type="range" class="webrtc-volume-slider" min="0" max="1" step="0.05" value="' + as.speakerVolume + '" oninput="document.getElementById(\'webrtc-spk-vol-pct\').textContent=Math.round(this.value*100)+\'%\';WebRTCPhone.setSpeakerVolume(this.value)">';
		html += '<span id="webrtc-spk-vol-pct" class="webrtc-volume-pct">' + spkVolPct + '%</span>';
		html += '</div></div>';

		html += '<div class="webrtc-settings-section">';
		html += '<div class="webrtc-settings-title">&#127908; Microphone</div>';
		html += '<select class="webrtc-select webrtc-select-sm" onchange="WebRTCPhone.setMicDevice(this.value)">';
		html += '<option value="default"' + (as.micDeviceId === 'default' ? ' selected' : '') + '>Default</option>';
		for (var m = 0; m < devices.inputs.length; m++) {
			var dm = devices.inputs[m];
			html += '<option value="' + escapeHtml(dm.id) + '"' + (dm.id === as.micDeviceId ? ' selected' : '') + '>' + escapeHtml(dm.label) + '</option>';
		}
		html += '</select>';
		if (devices.inputs.length === 0) html += '<div class="webrtc-settings-note">Grant microphone access to list devices.</div>';
		html += '</div>';

		html += '<button class="webrtc-btn webrtc-btn-primary webrtc-settings-done" onclick="WebRTCPhone.closeSettings()">Done</button>';
		html += '</div>';
		return html;
	}

	function renderDialPad() {
		var html = '<div class="webrtc-dialpad">';
		html += '<input type="text" id="webrtc-dial-input" class="webrtc-input" placeholder="Enter number..." value="' + escapeHtml(state.dialInput) + '" onkeydown="if(event.key===\'Enter\')WebRTCPhone.call()" oninput="WebRTCPhone.updateDialInput(this.value)">';
		html += '<div class="webrtc-dialpad-grid">';
		var keys = [
			{ key: '1', sub: '' }, { key: '2', sub: 'ABC' }, { key: '3', sub: 'DEF' },
			{ key: '4', sub: 'GHI' }, { key: '5', sub: 'JKL' }, { key: '6', sub: 'MNO' },
			{ key: '7', sub: 'PQRS' }, { key: '8', sub: 'TUV' }, { key: '9', sub: 'WXYZ' },
			{ key: '*', sub: '' }, { key: '0', sub: '+' }, { key: '#', sub: '' }
		];
		for (var i = 0; i < keys.length; i++) {
			html += '<button class="webrtc-key" onclick="WebRTCPhone.pressKey(\'' + keys[i].key + '\')">';
			html += '<span class="webrtc-key-main">' + keys[i].key + '</span>';
			if (keys[i].sub) html += '<span class="webrtc-key-sub">' + keys[i].sub + '</span>';
			html += '</button>';
		}
		html += '</div>';
		html += '<div class="webrtc-dial-actions">';
		html += '<button class="webrtc-btn webrtc-btn-call" onclick="WebRTCPhone.call()" ' + (!state.registered ? 'disabled title="Not registered"' : '') + '>';
		html += '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/></svg> Call</button>';
		html += '<button class="webrtc-btn webrtc-btn-backspace" onclick="WebRTCPhone.backspace()" title="Backspace">';
		html += '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>';
		html += '</button></div></div>';
		return html;
	}

	function renderInCallDTMF() {
		var html = '<div class="webrtc-incall-dtmf"><div class="webrtc-dialpad-grid webrtc-dialpad-sm">';
		var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
		for (var i = 0; i < keys.length; i++)
			html += '<button class="webrtc-key webrtc-key-sm" onclick="WebRTCPhone.dtmf(\'' + keys[i] + '\')">' + keys[i] + '</button>';
		html += '</div></div>';
		return html;
	}

	function renderError(message) {
		if (!state.mountEl) return;
		state.mountEl.innerHTML = '<div class="webrtc-phone-inner"><div class="webrtc-phone-header"><span class="webrtc-phone-title">WebRTC Phone</span><button class="webrtc-close-btn" onclick="WebRTCPhone.toggle()" title="Close">&times;</button></div><div class="webrtc-phone-body"><div class="webrtc-error">' + escapeHtml(message) + '</div></div></div>';
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
		var el = document.getElementById('webrtc-status');
		if (!el) { renderPhone(); return; }
		el.className = 'webrtc-status webrtc-status-' + status;
		var labels = { registered: 'Registered', unregistered: 'Unregistered', connecting: 'Connecting...', error: 'Error' };
		el.textContent = labels[status] || status;
	}

	function showFABBadge(text) {
		var badge = document.getElementById('webrtc-phone-fab-badge');
		if (badge) { badge.textContent = text; badge.classList.remove('hidden'); }
	}

	function hideFABBadge() {
		var badge = document.getElementById('webrtc-phone-fab-badge');
		if (badge) badge.classList.add('hidden');
	}

	function toggle() {
		var panel = document.getElementById('webrtc-phone-panel');
		if (panel) { state.visible = !state.visible; panel.classList.toggle('hidden', !state.visible); }
	}

	function showPanel() {
		var panel = document.getElementById('webrtc-phone-panel');
		if (panel) { state.visible = true; panel.classList.remove('hidden'); }
	}

	function pressKey(key) {
		state.dialInput += key;
		var dialEl = document.getElementById('webrtc-dial-input');
		if (dialEl) { dialEl.value = state.dialInput; dialEl.focus(); }
	}

	function backspace() {
		if (state.dialInput.length > 0) {
			state.dialInput = state.dialInput.slice(0, -1);
			var dialEl = document.getElementById('webrtc-dial-input');
			if (dialEl) dialEl.value = state.dialInput;
		}
	}

	function updateDialInput(val) { state.dialInput = val; }

	function clearDial() {
		state.dialInput = '';
		var dialEl = document.getElementById('webrtc-dial-input');
		if (dialEl) dialEl.value = '';
	}

	function call() {
		var dialEl = document.getElementById('webrtc-dial-input');
		if (dialEl) state.dialInput = dialEl.value.trim();
		if (!state.dialInput) return;
		makeCall(state.dialInput);
	}

	function switchExtension(index) {
		index = parseInt(index);
		if (isNaN(index) || !state.extensions[index]) return;
		if (state.currentSession) hangupCall();
		unregisterSIP();
		state.selectedExtension = state.extensions[index];
		renderPhone(); registerSIP();
	}

	function transfer() {
		var input = document.getElementById('webrtc-transfer-input');
		if (input && input.value.trim()) transferCall(input.value.trim());
	}

	function escapeHtml(str) {
		if (!str) return '';
		var div = document.createElement('div');
		div.appendChild(document.createTextNode(str));
		return div.innerHTML;
	}

	// --- Public API ---

	return {
		init: init, toggle: toggle,
		selectExtension: selectExtension, switchExtension: switchExtension,
		pressKey: pressKey, backspace: backspace, updateDialInput: updateDialInput, clearDial: clearDial,
		call: call, answer: answerCall, reject: rejectCall, hangup: hangupCall,
		toggleMute: toggleMute, toggleHold: toggleHold, dtmf: sendDTMF, transfer: transfer,
		openSettings: openSettings, closeSettings: closeSettings,
		setRingtone: setRingtone, setRingVolume: setRingVolume, setSpeakerVolume: setSpeakerVolume,
		setRingDevice: setRingDevice, setSpeakerDevice: setSpeakerDevice, setMicDevice: setMicDevice,
		previewRingtone: previewRingtone
	};

})();
