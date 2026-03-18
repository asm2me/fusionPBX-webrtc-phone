/*
	FusionPBX WebRTC Phone
	Browser-based SIP softphone using JsSIP over WebSocket Secure (WSS).
	Fetches the active user's extensions from FusionPBX and registers via WebRTC.
*/

var WebRTCPhone = (function () {
	'use strict';

	// --- Internationalization ---
	var defaultLang = {
		phone: 'Phone',
		call: 'Call',
		hangUp: 'Hang Up',
		answer: 'Answer',
		reject: 'Reject',
		mute: 'Mute',
		unmute: 'Unmute',
		hold: 'Hold',
		resume: 'Resume',
		transfer: 'Transfer',
		transferTo: 'Transfer to:',
		send: 'Send',
		dialpad: 'Dialpad',
		history: 'History',
		network: 'Network',
		settings: 'Settings',
		idle: 'Idle',
		connecting: 'Connecting...',
		registered: 'Registered',
		error: 'Error',
		incomingCall: 'Incoming Call',
		outgoingCall: 'Calling...',
		inCall: 'In Call',
		measuring: 'Measuring...',
		noExtensions: 'No extensions assigned to your account.',
		selectExtension: 'Select extension...',
		connect: 'Connect',
		disconnect: 'Disconnect',
		noRecentCalls: 'No recent calls',
		clearHistory: 'Clear History',
		// Quality
		excellent: 'Excellent',
		good: 'Good',
		fair: 'Fair',
		poor: 'Poor',
		// Network test
		networkQualityTest: 'Network Quality Test',
		runningTests: 'Running tests...',
		wssServer: 'WSS Server',
		stunServer: 'STUN Server',
		latency: 'Latency',
		systemJitter: 'System Jitter',
		sipSignaling: 'SIP Signaling',
		echoTest: 'Echo Test',
		dialingEcho: 'Dialing *9196...',
		collectingStats: 'Collecting audio stats...',
		internetBaseline: 'Internet Baseline',
		bandwidth: 'Bandwidth',
		download: 'Download',
		upload: 'Upload',
		available: 'Available',
		// Audio test
		audioMicTest: 'Audio & Microphone Test',
		microphone: 'Microphone',
		echoReturn: 'Echo Return',
		fullDuplex: 'Full Duplex',
		twoWayAudio: 'Two-way audio confirmed',
		audioPathIncomplete: 'Audio path incomplete',
		strong: 'Strong',
		normal: 'Normal',
		weak: 'Weak',
		silent: 'Silent',
		// Path trace
		pathTrace: 'Path Trace',
		serverRoute: 'Server Route',
		stability: 'Stability',
		natType: 'NAT Type',
		pingProfile: 'Ping Profile',
		pathStable: 'Path Stable',
		pathUnstable: 'Path Unstable',
		// Diagnosis
		diagnosis: 'Diagnosis',
		issueSource: 'Issue source',
		yourNetwork: 'Your Network',
		voipServer: 'VoIP Server',
		noIssues: 'No Issues',
		undetermined: 'Undetermined',
		findings: 'Findings:',
		suggestedFixes: 'Suggested Fixes:',
		runTest: 'Run Test',
		reTest: 'Re-test',
		close: 'Close',
		// Audio settings
		audioSettings: 'Audio Settings',
		ringtone: 'Ringtone',
		ringVolume: 'Ring Volume',
		speakerVolume: 'Speaker Volume',
		micVolume: 'Mic Volume',
		micAGC: 'Mic AGC (Auto Gain)',
		spkAGC: 'Speaker AGC (Normalize)',
		micDevice: 'Microphone',
		speakerDevice: 'Speaker',
		ringDevice: 'Ring Device',
		defaultDevice: 'Default',
		preview: 'Preview',
		stop: 'Stop',
		// Stats
		packets: 'Packets',
		recv: 'Recv',
		sent: 'Sent',
		loss: 'Loss',
		jitter: 'Jitter',
		rtt: 'RTT',
		// Report
		downloadPDF: 'Download PDF',
		sendReport: 'Send Report',
		sending: 'Sending...',
		reportSent: 'Report sent successfully!',
		reportFailed: 'Failed to send report',
		popupBlocked: 'Please allow popups to download the report'
	};

	function t(key) {
		var lang = window.webrtcPhoneLang || {};
		return lang[key] || defaultLang[key] || key;
	}

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
			micVolume: 1.0,
			micAGC: false,
			spkAGC: false,
			ringDeviceId: 'default',
			speakerDeviceId: 'default',
			micDeviceId: 'default'
		},
		micGainNode: null,
		spkGainNode: null,
		micCompressor: null,
		spkCompressor: null,
		showSettings: false,
		audioDevices: { inputs: [], outputs: [] },
		previewingRingtone: false,
		previewTimeout: null,
		// Call history
		callHistory: [],
		showHistory: false,
		currentCallRecord: null,
		// Call quality monitoring
		qualityMonitor: null,       // interval ID for stats polling
		qualityStats: null,         // current quality metrics
		qualityHistory: [],         // samples collected during call
		prevStats: null,            // previous getStats snapshot for delta calc
		// Network test
		showNetworkTest: false,
		networkTestRunning: false,
		networkTestResults: null,
		// Audio levels
		audioLevelCtx: null,
		micAnalyser: null,
		spkAnalyser: null,
		audioLevelInterval: null,
		micLevel: 0,
		spkLevel: 0
	};

	// --- Initialization ---

	function init(mountId) {
		if (state.initialized) return;
		state.mountEl = document.getElementById(mountId);
		if (!state.mountEl) return;

		loadAudioSettings();
		loadCallHistory();

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
				var mv = parseFloat(p.micVolume);
				if (!isNaN(mv)) state.audioSettings.micVolume = Math.max(0, Math.min(1, mv));
				if (typeof p.micAGC === 'boolean') state.audioSettings.micAGC = p.micAGC;
				if (typeof p.spkAGC === 'boolean') state.audioSettings.spkAGC = p.spkAGC;
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

	// --- Call History ---

	function loadCallHistory() {
		try {
			var saved = localStorage.getItem('webrtc_phone_call_history');
			if (saved) {
				var parsed = JSON.parse(saved);
				if (Array.isArray(parsed)) state.callHistory = parsed;
			}
		} catch (e) {
			console.warn('WebRTC Phone: Failed to load call history', e);
		}
	}

	function saveCallHistory() {
		try {
			localStorage.setItem('webrtc_phone_call_history', JSON.stringify(state.callHistory));
		} catch (e) {
			console.warn('WebRTC Phone: Failed to save call history', e);
		}
	}

	function addCallToHistory(record) {
		if (!record) return;
		state.callHistory.unshift(record);
		if (state.callHistory.length > 50) state.callHistory = state.callHistory.slice(0, 50);
		saveCallHistory();
	}

	function openHistory() {
		state.showHistory = true;
		state.showNetworkTest = false;
		renderPhone();
	}

	function closeHistory() {
		state.showHistory = false;
		renderPhone();
	}

	function clearHistory() {
		state.callHistory = [];
		saveCallHistory();
		renderPhone();
	}

	function dialFromHistory(index) {
		var record = state.callHistory[index];
		if (!record || !record.number) return;
		state.showHistory = false;
		state.dialInput = record.number;
		renderPhone();
		var dialEl = document.getElementById('webrtc-dial-input');
		if (dialEl) { dialEl.value = record.number; dialEl.focus(); }
	}

	function formatTimeAgo(ts) {
		var diff = Math.floor((Date.now() - ts) / 1000);
		if (diff < 60) return 'Just now';
		if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
		if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
		if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
		var d = new Date(ts);
		return (d.getMonth() + 1) + '/' + d.getDate();
	}

	// --- Call Quality Monitoring ---

	function startQualityMonitor() {
		stopQualityMonitor();
		state.qualityStats = null;
		state.qualityHistory = [];
		state.prevStats = null;
		state.qualityMonitor = setInterval(function () { collectQualityStats(); }, 2000);
	}

	function stopQualityMonitor() {
		if (state.qualityMonitor) { clearInterval(state.qualityMonitor); state.qualityMonitor = null; }
	}

	function collectQualityStats() {
		if (!state.currentSession || state.callState !== 'in_call') return;
		var pc = null;
		try { pc = state.currentSession.connection; } catch (e) {}
		if (!pc || !pc.getStats) return;

		pc.getStats().then(function (stats) {
			var inbound = null, outbound = null, candidatePair = null, codec = null;
			stats.forEach(function (r) {
				if (r.type === 'inbound-rtp' && r.kind === 'audio' && !r.isRemote) inbound = r;
				if (r.type === 'outbound-rtp' && r.kind === 'audio' && !r.isRemote) outbound = r;
				if (r.type === 'candidate-pair' && r.nominated) candidatePair = r;
				if (r.type === 'codec' && r.mimeType && r.mimeType.indexOf('audio') === 0) codec = r;
			});

			if (!inbound) return;

			var prev = state.prevStats;
			var now = {
				timestamp: inbound.timestamp || Date.now(),
				packetsReceived: inbound.packetsReceived || 0,
				packetsLost: inbound.packetsLost || 0,
				bytesReceived: inbound.bytesReceived || 0,
				jitter: inbound.jitter || 0,
				rtt: candidatePair ? (candidatePair.currentRoundTripTime || 0) : 0,
				packetsSent: outbound ? (outbound.packetsSent || 0) : 0,
				bytesSent: outbound ? (outbound.bytesSent || 0) : 0
			};

			var quality = {
				jitter: now.jitter * 1000,  // convert to ms
				rtt: now.rtt * 1000,        // convert to ms
				packetLoss: 0,
				bitrateIn: 0,
				bitrateOut: 0,
				codec: codec ? codec.mimeType.replace('audio/', '') : '',
				mos: 0,
				rating: 'unknown',
				issues: []
			};

			if (prev) {
				var timeDelta = (now.timestamp - prev.timestamp) / 1000;
				if (timeDelta > 0) {
					var lostDelta = now.packetsLost - prev.packetsLost;
					var recvDelta = now.packetsReceived - prev.packetsReceived;
					var totalDelta = lostDelta + recvDelta;
					quality.packetLoss = totalDelta > 0 ? (lostDelta / totalDelta) * 100 : 0;
					if (quality.packetLoss < 0) quality.packetLoss = 0;
					quality.bitrateIn = Math.round(((now.bytesReceived - prev.bytesReceived) * 8) / timeDelta / 1000);
					quality.bitrateOut = Math.round(((now.bytesSent - prev.bytesSent) * 8) / timeDelta / 1000);
				}
			}

			// Calculate MOS score (simplified E-model)
			quality.mos = calculateMOS(quality.rtt, quality.jitter, quality.packetLoss);
			quality.rating = mosToRating(quality.mos);
			quality.issues = detectIssues(quality);

			state.qualityStats = quality;
			state.qualityHistory.push({
				ts: Date.now(),
				mos: quality.mos,
				jitter: quality.jitter,
				packetLoss: quality.packetLoss,
				rtt: quality.rtt,
				bitrateIn: quality.bitrateIn
			});

			state.prevStats = now;
			updateQualityDisplay();
		}).catch(function (e) {
			console.warn('WebRTC Phone: getStats failed', e);
		});
	}

	function calculateMOS(rtt, jitter, packetLoss) {
		// Simplified E-model ITU-T G.107
		var effectiveLatency = rtt + jitter * 2 + 10; // 10ms processing delay
		var R;
		if (effectiveLatency < 160) {
			R = 93.2 - (effectiveLatency / 40);
		} else {
			R = 93.2 - ((effectiveLatency - 120) / 10);
		}
		// Packet loss impact
		R = R - (packetLoss * 2.5);
		// Clamp
		if (R < 0) R = 0;
		if (R > 100) R = 100;
		// Convert R to MOS
		var mos = 1 + 0.035 * R + R * (R - 60) * (100 - R) * 7e-6;
		if (mos < 1) mos = 1;
		if (mos > 5) mos = 5;
		return Math.round(mos * 10) / 10;
	}

	function mosToRating(mos) {
		if (mos >= 4.0) return 'excellent';
		if (mos >= 3.5) return 'good';
		if (mos >= 2.5) return 'fair';
		return 'poor';
	}

	function detectIssues(q) {
		var issues = [];
		if (q.packetLoss > 5) issues.push('High packet loss (' + q.packetLoss.toFixed(1) + '%)');
		else if (q.packetLoss > 1) issues.push('Packet loss (' + q.packetLoss.toFixed(1) + '%)');
		if (q.jitter > 50) issues.push('High jitter (' + Math.round(q.jitter) + 'ms)');
		else if (q.jitter > 20) issues.push('Jitter (' + Math.round(q.jitter) + 'ms)');
		if (q.rtt > 300) issues.push('High latency (' + Math.round(q.rtt) + 'ms)');
		else if (q.rtt > 150) issues.push('Latency (' + Math.round(q.rtt) + 'ms)');
		if (q.bitrateIn > 0 && q.bitrateIn < 20) issues.push('Low bitrate (' + q.bitrateIn + ' kbps)');
		return issues;
	}

	function getQualityIcon(rating) {
		switch (rating) {
			case 'excellent': return '&#9679;&#9679;&#9679;&#9679;'; // 4 dots
			case 'good': return '&#9679;&#9679;&#9679;&#9675;';
			case 'fair': return '&#9679;&#9679;&#9675;&#9675;';
			case 'poor': return '&#9679;&#9675;&#9675;&#9675;';
			default: return '&#9675;&#9675;&#9675;&#9675;';
		}
	}

	function updateQualityDisplay() {
		var el = document.getElementById('webrtc-quality-indicator');
		if (!el || !state.qualityStats) return;
		var q = state.qualityStats;
		el.className = 'webrtc-quality-indicator webrtc-quality-' + q.rating;
		el.innerHTML = '<span class="webrtc-quality-dots">' + getQualityIcon(q.rating) + '</span> ' +
			'<span class="webrtc-quality-label">' + t(q.rating) + '</span>';

		var detailEl = document.getElementById('webrtc-quality-details');
		if (detailEl) {
			var details = '';
			details += 'MOS: ' + q.mos.toFixed(1) + ' | Jitter: ' + Math.round(q.jitter) + 'ms';
			details += ' | Loss: ' + q.packetLoss.toFixed(1) + '% | RTT: ' + Math.round(q.rtt) + 'ms';
			if (q.codec) details += ' | Codec: ' + q.codec;
			detailEl.textContent = details;
		}

		var issueEl = document.getElementById('webrtc-quality-issues');
		if (issueEl) {
			issueEl.innerHTML = q.issues.length > 0 ?
				q.issues.map(function (i) { return '<span class="webrtc-quality-issue">' + escapeHtml(i) + '</span>'; }).join('') : '';
		}

		// Update header color based on call quality
		var headerEl = document.querySelector('.webrtc-phone-header');
		if (headerEl) {
			var headerColors = {
				excellent: '#2e7d32',
				good: '#1a73e8',
				fair: '#e65100',
				poor: '#c62828'
			};
			headerEl.style.background = headerColors[q.rating] || '#1a73e8';
		}
	}

	function getCallQualitySummary() {
		if (state.qualityHistory.length === 0) return null;
		var sum = { mos: 0, jitter: 0, packetLoss: 0, rtt: 0 };
		var n = state.qualityHistory.length;
		for (var i = 0; i < n; i++) {
			sum.mos += state.qualityHistory[i].mos;
			sum.jitter += state.qualityHistory[i].jitter;
			sum.packetLoss += state.qualityHistory[i].packetLoss;
			sum.rtt += state.qualityHistory[i].rtt;
		}
		var avg = {
			mos: Math.round((sum.mos / n) * 10) / 10,
			jitter: Math.round(sum.jitter / n),
			packetLoss: Math.round((sum.packetLoss / n) * 10) / 10,
			rtt: Math.round(sum.rtt / n)
		};
		avg.rating = mosToRating(avg.mos);
		avg.issues = detectIssues(avg);
		return avg;
	}

	// --- Network Quality Test ---

	function openNetworkTest() {
		state.showNetworkTest = true;
		state.showHistory = false;
		state.networkTestResults = null;
		renderPhone();
	}

	function closeNetworkTest() {
		state.showNetworkTest = false;
		renderPhone();
	}

	function runNetworkTest() {
		if (state.networkTestRunning || !state.config) return;
		state.networkTestRunning = true;
		state.networkTestResults = { wss: null, stun: null, turn: null, turnAudio: null, latency: null, jitterTest: null, sipPing: null, demoCall: null, refPings: null, diagnosis: null, pathTrace: null };
		renderPhone();

		var results = state.networkTestResults;
		var testsRemaining = 8; // WSS, STUN+latency, TURN, TURN audio stability, jitter, SIP ping, reference pings, path trace
		function checkDone() {
			testsRemaining--;
			if (testsRemaining <= 0) {
				state.networkTestRunning = false;
				results.diagnosis = generateDiagnosis(results);
				renderPhone();
			} else {
				renderPhone();
			}
		}

		// Test 1: WSS connectivity + round-trip
		(function testWSS() {
			var start = Date.now();
			var ws = null;
			var timeout = setTimeout(function () {
				results.wss = { ok: false, time: 0, error: 'Timeout (5s)' };
				try { ws.close(); } catch (e) {}
				checkDone();
			}, 5000);
			try {
				var wssTestUrl = (state.config.wss_port == '443') ? 'wss://' + state.config.domain + '/wss' : 'wss://' + state.config.domain + ':' + state.config.wss_port;
				ws = new WebSocket(wssTestUrl);
				ws.onopen = function () {
					clearTimeout(timeout);
					results.wss = { ok: true, time: Date.now() - start };
					ws.close();
					checkDone();
				};
				ws.onerror = function () {
					clearTimeout(timeout);
					results.wss = { ok: false, time: 0, error: 'Connection refused' };
					checkDone();
				};
			} catch (e) {
				clearTimeout(timeout);
				results.wss = { ok: false, time: 0, error: e.message };
				checkDone();
			}
		})();

		// Test 2: STUN server reachability + latency
		(function testSTUN() {
			var start = Date.now();
			var timeout = setTimeout(function () {
				results.stun = { ok: false, time: 0, error: 'Timeout (5s)' };
				results.latency = { rtt: 0, error: 'STUN timeout' };
				checkDone();
			}, 5000);
			try {
				var pc = new RTCPeerConnection({ iceServers: getICEServers() });
				pc.createDataChannel('test');
				var gotCandidate = false;
				pc.onicecandidate = function (e) {
					if (gotCandidate) return;
					if (e.candidate && e.candidate.type === 'srflx') {
						gotCandidate = true;
						clearTimeout(timeout);
						var elapsed = Date.now() - start;
						results.stun = { ok: true, time: elapsed, ip: e.candidate.address || e.candidate.ip || '' };
						results.latency = { rtt: elapsed };
						pc.close();
						checkDone();
					}
				};
				pc.onicegatheringstatechange = function () {
					if (pc.iceGatheringState === 'complete' && !gotCandidate) {
						clearTimeout(timeout);
						results.stun = { ok: false, time: 0, error: 'No server reflexive candidate (NAT issue)' };
						results.latency = { rtt: 0, error: 'No srflx candidate' };
						pc.close();
						checkDone();
					}
				};
				pc.createOffer().then(function (offer) {
					return pc.setLocalDescription(offer);
				}).catch(function (e) {
					clearTimeout(timeout);
					results.stun = { ok: false, time: 0, error: e.message };
					results.latency = { rtt: 0, error: e.message };
					checkDone();
				});
			} catch (e) {
				clearTimeout(timeout);
				results.stun = { ok: false, time: 0, error: e.message };
				results.latency = { rtt: 0, error: e.message };
				checkDone();
			}
		})();

		// Test 2b: TURN server connectivity
		(function testTURN() {
			if (!state.config.turn_server) {
				results.turn = { ok: false, error: 'Not configured' };
				checkDone();
				return;
			}
			var start = Date.now();
			var timeout = setTimeout(function () {
				results.turn = { ok: false, error: 'Timeout (8s)' };
				try { pc.close(); } catch (e) {}
				checkDone();
			}, 8000);
			try {
				var turnConfig = { urls: state.config.turn_server };
				if (state.config.turn_username) turnConfig.username = state.config.turn_username;
				if (state.config.turn_password) turnConfig.credential = state.config.turn_password;
				var pc = new RTCPeerConnection({ iceServers: [turnConfig], iceTransportPolicy: 'relay' });
				pc.createDataChannel('turntest');
				var gotRelay = false;
				pc.onicecandidate = function (e) {
					if (gotRelay) return;
					if (e.candidate && e.candidate.type === 'relay') {
						gotRelay = true;
						clearTimeout(timeout);
						var elapsed = Date.now() - start;
						results.turn = { ok: true, time: elapsed, relayIP: e.candidate.address || e.candidate.ip || '' };
						pc.close();
						checkDone();
					}
				};
				pc.onicegatheringstatechange = function () {
					if (pc.iceGatheringState === 'complete' && !gotRelay) {
						clearTimeout(timeout);
						results.turn = { ok: false, error: 'No relay candidate received' };
						pc.close();
						checkDone();
					}
				};
				pc.createOffer().then(function (offer) {
					return pc.setLocalDescription(offer);
				}).catch(function (e) {
					clearTimeout(timeout);
					results.turn = { ok: false, error: e.message };
					checkDone();
				});
			} catch (e) {
				clearTimeout(timeout);
				results.turn = { ok: false, error: e.message };
				checkDone();
			}
		})();

		// Test 3: TURN audio stability — loopback two PeerConnections via TURN relay
		(function testTURNAudio() {
			if (!state.config || !state.config.turn_server) {
				results.turnAudio = { ok: false, error: 'TURN not configured' };
				checkDone();
				return;
			}
			var turnConfig = { urls: state.config.turn_server };
			if (state.config.turn_username) turnConfig.username = state.config.turn_username;
			if (state.config.turn_password) turnConfig.credential = state.config.turn_password;
			var pcConfig = { iceServers: [turnConfig], iceTransportPolicy: 'relay' };

			var pc1 = null, pc2 = null, statsInterval = null;
			var testDuration = 5000; // 5 seconds of audio
			var timeout = setTimeout(function () { finish({ ok: false, error: 'Timeout (12s)' }); }, 12000);

			function finish(result) {
				clearTimeout(timeout);
				if (statsInterval) clearInterval(statsInterval);
				try { if (pc1) pc1.close(); } catch (e) {}
				try { if (pc2) pc2.close(); } catch (e) {}
				results.turnAudio = result;
				checkDone();
			}

			try {
				pc1 = new RTCPeerConnection(pcConfig);
				pc2 = new RTCPeerConnection(pcConfig);

				// Exchange ICE candidates
				pc1.onicecandidate = function (e) { if (e.candidate) { try { pc2.addIceCandidate(e.candidate); } catch (ex) {} } };
				pc2.onicecandidate = function (e) { if (e.candidate) { try { pc1.addIceCandidate(e.candidate); } catch (ex) {} } };

				// When pc2 receives audio, start measuring stats
				pc2.ontrack = function (event) {
					var statsSamples = [];
					var prevPackets = 0, prevLost = 0, prevBytes = 0, prevTime = 0;

					statsInterval = setInterval(function () {
						pc2.getStats().then(function (stats) {
							stats.forEach(function (r) {
								if (r.type === 'inbound-rtp' && r.kind === 'audio') {
									var sample = {
										jitter: (r.jitter || 0) * 1000,
										packets: r.packetsReceived || 0,
										lost: r.packetsLost || 0,
										bytes: r.bytesReceived || 0,
										ts: r.timestamp || Date.now()
									};
									if (prevTime > 0) {
										var dt = (sample.ts - prevTime) / 1000;
										if (dt > 0) {
											sample.packetsDelta = sample.packets - prevPackets;
											sample.lostDelta = sample.lost - prevLost;
											sample.bitrate = Math.round(((sample.bytes - prevBytes) * 8) / dt / 1000);
										}
									}
									prevPackets = sample.packets;
									prevLost = sample.lost;
									prevBytes = sample.bytes;
									prevTime = sample.ts;
									statsSamples.push(sample);
								}
							});
						}).catch(function () {});
					}, 500);

					// After test duration, analyze
					setTimeout(function () {
						clearInterval(statsInterval);
						if (statsSamples.length < 2) {
							finish({ ok: false, error: 'No audio stats collected' });
							return;
						}
						// Analyze
						var lastSample = statsSamples[statsSamples.length - 1];
						var totalPackets = lastSample.packets;
						var totalLost = lastSample.lost;
						var lossPercent = totalPackets > 0 ? Math.round((totalLost / (totalPackets + totalLost)) * 1000) / 10 : 0;
						var jitters = statsSamples.map(function (s) { return s.jitter; }).filter(function (j) { return j >= 0; });
						var avgJitter = 0;
						if (jitters.length > 0) {
							var jSum = 0;
							for (var j = 0; j < jitters.length; j++) jSum += jitters[j];
							avgJitter = Math.round(jSum / jitters.length);
						}
						var bitrates = statsSamples.filter(function (s) { return s.bitrate > 0; }).map(function (s) { return s.bitrate; });
						var avgBitrate = 0;
						if (bitrates.length > 0) {
							var bSum = 0;
							for (var b = 0; b < bitrates.length; b++) bSum += bitrates[b];
							avgBitrate = Math.round(bSum / bitrates.length);
						}

						var ok = lossPercent < 5 && avgJitter < 50;
						var rating = lossPercent < 1 && avgJitter < 20 ? 'excellent' : (lossPercent < 3 && avgJitter < 30 ? 'good' : (ok ? 'fair' : 'poor'));
						var issues = [];
						if (lossPercent > 5) issues.push('High packet loss: ' + lossPercent + '%');
						else if (lossPercent > 1) issues.push('Packet loss: ' + lossPercent + '%');
						if (avgJitter > 50) issues.push('High jitter: ' + avgJitter + 'ms');
						else if (avgJitter > 20) issues.push('Jitter: ' + avgJitter + 'ms');

						finish({
							ok: ok,
							rating: rating,
							packetLoss: lossPercent,
							jitter: avgJitter,
							bitrate: avgBitrate,
							packetsReceived: totalPackets,
							packetsLost: totalLost,
							samples: statsSamples.length,
							issues: issues
						});
					}, testDuration);
				};

				// Get microphone and add track to pc1
				navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
					stream.getTracks().forEach(function (track) { pc1.addTrack(track, stream); });

					// Create offer/answer
					pc1.createOffer().then(function (offer) {
						return pc1.setLocalDescription(offer);
					}).then(function () {
						return pc2.setRemoteDescription(pc1.localDescription);
					}).then(function () {
						return pc2.createAnswer();
					}).then(function (answer) {
						return pc2.setLocalDescription(answer);
					}).then(function () {
						return pc1.setRemoteDescription(pc2.localDescription);
					}).catch(function (e) {
						finish({ ok: false, error: 'SDP negotiation failed: ' + e.message });
					});
				}).catch(function (e) {
					finish({ ok: false, error: 'Microphone access denied' });
				});

			} catch (e) {
				finish({ ok: false, error: e.message });
			}
		})();

		// Test 4: Jitter estimation via timing consistency
		(function testJitter() {
			var samples = [];
			var count = 0;
			var maxSamples = 10;
			var prev = performance.now();
			var interval = setInterval(function () {
				var now = performance.now();
				samples.push(now - prev - 50); // deviation from expected 50ms
				prev = now;
				count++;
				if (count >= maxSamples) {
					clearInterval(interval);
					var sum = 0;
					for (var i = 0; i < samples.length; i++) sum += Math.abs(samples[i]);
					var avgJitter = Math.round(sum / samples.length);
					results.jitterTest = { jitter: avgJitter, ok: avgJitter < 30 };
					checkDone();
				}
			}, 50);
		})();

		// Test 4: SIP signaling ping (OPTIONS round-trip via registered UA)
		(function testSIPPing() {
			if (!state.ua || !state.registered) {
				results.sipPing = { ok: false, time: 0, error: 'Not registered' };
				checkDone();
				return;
			}
			var start = Date.now();
			var timeout = setTimeout(function () {
				results.sipPing = { ok: false, time: 0, error: 'Timeout (5s)' };
				checkDone();
			}, 5000);
			try {
				var domain = state.config.domain;
				var targetURI = 'sip:' + domain;
				state.ua.sendMessage(targetURI, 'ping', {
					contentType: 'text/plain',
					eventHandlers: {
						succeeded: function () {
							clearTimeout(timeout);
							results.sipPing = { ok: true, time: Date.now() - start };
							checkDone();
						},
						failed: function (e) {
							clearTimeout(timeout);
							// A 405/other response still proves SIP signaling works
							var elapsed = Date.now() - start;
							if (elapsed < 4500) {
								results.sipPing = { ok: true, time: elapsed, note: 'SIP response received' };
							} else {
								results.sipPing = { ok: false, time: 0, error: e && e.cause ? e.cause : 'Failed' };
							}
							checkDone();
						}
					}
				});
			} catch (e) {
				clearTimeout(timeout);
				results.sipPing = { ok: false, time: 0, error: e.message || 'SIP error' };
				checkDone();
			}
		})();

		// Test 5: Reference latency pings to third-party servers (image load timing)
		(function testReferencePings() {
			var domain = state.config ? state.config.domain : '';
			var refServers = [
				{ name: domain || 'VoIP Server', url: 'https://' + (domain || 'localhost') + '/favicon.ico' },
				{ name: 'cloudflare.com', url: 'https://1.1.1.1/cdn-cgi/trace' },
				{ name: 'google.com', url: 'https://www.google.com/generate_204' }
			];
			var refResults = [];
			var remaining = refServers.length;

			function refDone() {
				remaining--;
				if (remaining <= 0) {
					results.refPings = refResults;
					checkDone();
				}
			}

			for (var ri = 0; ri < refServers.length; ri++) {
				(function (server) {
					// Do 4 pings: first is warmup (DNS+TCP+TLS), last 3 are real (reuse connection ≈ ICMP RTT)
					var totalPings = 4;
					var warmupCount = 1;
					var allPings = [];
					var pinged = 0;

					function doPing() {
						if (pinged >= totalPings) {
							// Discard warmup pings, keep only real measurements
							var realPings = allPings.slice(warmupCount);
							var okPings = realPings.filter(function(p) { return p > 0; });
							var failCount = realPings.length - okPings.length;
							var avgTime = 0;
							if (okPings.length > 0) {
								var sum = 0;
								for (var i = 0; i < okPings.length; i++) sum += okPings[i];
								avgTime = Math.round(sum / okPings.length);
							}
							refResults.push({
								name: server.name,
								ok: okPings.length > 0,
								time: avgTime,
								loss: failCount + '/' + realPings.length,
								lossPercent: Math.round((failCount / realPings.length) * 100),
								error: okPings.length === 0 ? 'All pings failed' : ''
							});
							refDone();
							return;
						}

						var start = performance.now();
						var timeout = setTimeout(function () {
							allPings.push(-1);
							pinged++;
							doPing();
						}, 4000);

						var done = false;
						function recordPing(elapsed) {
							if (done) return;
							done = true;
							clearTimeout(timeout);
							allPings.push(elapsed);
							pinged++;
							setTimeout(doPing, 50);
						}
						var xhr = new XMLHttpRequest();
						xhr.open('HEAD', server.url + '?_cb=' + Date.now() + '_' + pinged, true);
						xhr.timeout = 3500;
						xhr.onload = function () {
							recordPing(Math.round(performance.now() - start));
						};
						xhr.ontimeout = function () {
							recordPing(-1);
						};
						xhr.onerror = function () {
							var elapsed = Math.round(performance.now() - start);
							recordPing(elapsed < 3500 ? elapsed : -1);
						};
						try { xhr.send(); } catch (e) {
							recordPing(-1);
						}
					}

					doPing();
				})(refServers[ri]);
			}
		})();

		// Test 8: Path trace - multi-ping latency profile + ICE candidate path analysis
		(function testPathTrace() {
			if (!state.config) {
				results.pathTrace = { ok: false, error: 'No config' };
				checkDone();
				return;
			}
			var domain = state.config.domain;
			var wssPort = state.config.wss_port || 7443;
			var totalPings = 12; // 2 warmup + 10 real
			var warmupPings = 2;
			var allSamples = [];
			var iceInfo = { candidates: [], localIP: '', publicIP: '', candidateTypes: [] };

			// Part A: Rapid sequential XHR pings (first 2 are warmup for TLS, rest are real)
			function doPing(index) {
				if (index >= totalPings) {
					finishPathTrace();
					return;
				}
				var start = performance.now();
				var done = false;
				var timeout = setTimeout(function () {
					if (!done) { done = true; allSamples.push({ hop: index + 1, time: -1, error: 'timeout' }); doPing(index + 1); }
				}, 3000);
				var xhr = new XMLHttpRequest();
				xhr.open('HEAD', 'https://' + domain + '/favicon.ico?_pt=' + Date.now() + '_' + index, true);
				xhr.timeout = 2500;
				xhr.onload = function () {
					if (done) return; done = true;
					clearTimeout(timeout);
					allSamples.push({ hop: index + 1, time: Math.round(performance.now() - start) });
					setTimeout(function () { doPing(index + 1); }, 50);
				};
				xhr.onerror = function () {
					if (done) return; done = true;
					clearTimeout(timeout);
					var elapsed = Math.round(performance.now() - start);
					allSamples.push({ hop: index + 1, time: elapsed < 2500 ? elapsed : -1 });
					setTimeout(function () { doPing(index + 1); }, 50);
				};
				xhr.ontimeout = function () {
					if (done) return; done = true;
					clearTimeout(timeout);
					allSamples.push({ hop: index + 1, time: -1, error: 'timeout' });
					doPing(index + 1);
				};
				try { xhr.send(); } catch (e) {
					if (done) return; done = true;
					clearTimeout(timeout);
					allSamples.push({ hop: index + 1, time: -1, error: e.message });
					doPing(index + 1);
				}
			}

			// Part B: ICE candidate gathering for path info
			try {
				var pc2 = new RTCPeerConnection({ iceServers: getICEServers() });
				pc2.createDataChannel('trace');
				pc2.onicecandidate = function (e) {
					if (e.candidate) {
						var c = e.candidate;
						iceInfo.candidates.push({
							type: c.type || 'unknown',
							protocol: c.protocol || '',
							address: c.address || c.ip || '',
							port: c.port || 0,
							priority: c.priority || 0
						});
						if (c.type === 'host' && c.address) iceInfo.localIP = c.address;
						if (c.type === 'srflx' && c.address) iceInfo.publicIP = c.address;
						if (iceInfo.candidateTypes.indexOf(c.type) === -1) iceInfo.candidateTypes.push(c.type);
					}
				};
				pc2.onicegatheringstatechange = function () {
					if (pc2.iceGatheringState === 'complete') {
						pc2.close();
					}
				};
				pc2.createOffer().then(function (offer) {
					return pc2.setLocalDescription(offer);
				}).catch(function () {});
			} catch (e) {}

			// Start pings
			doPing(0);

			function finishPathTrace() {
				// Discard warmup pings, keep real ones
				var pingSamples = allSamples.slice(warmupPings);
				var pingCount = pingSamples.length;
				// Re-number hops
				for (var h = 0; h < pingSamples.length; h++) pingSamples[h].hop = h + 1;

				var validPings = [];
				var failedCount = 0;
				for (var i = 0; i < pingSamples.length; i++) {
					if (pingSamples[i].time > 0) {
						validPings.push(pingSamples[i].time);
					} else {
						failedCount++;
					}
				}

				if (validPings.length === 0) {
					results.pathTrace = { ok: false, error: 'All pings failed', iceInfo: iceInfo, samples: pingSamples };
					checkDone();
					return;
				}

				// Statistics
				var sum = 0, min = 99999, max = 0;
				for (var j = 0; j < validPings.length; j++) {
					sum += validPings[j];
					if (validPings[j] < min) min = validPings[j];
					if (validPings[j] > max) max = validPings[j];
				}
				var avg = Math.round(sum / validPings.length);
				var jitterSum = 0;
				for (var k = 1; k < validPings.length; k++) {
					jitterSum += Math.abs(validPings[k] - validPings[k - 1]);
				}
				var jitter = validPings.length > 1 ? Math.round(jitterSum / (validPings.length - 1)) : 0;

				// Detect spikes (>2x average)
				var spikes = 0;
				for (var s = 0; s < validPings.length; s++) {
					if (validPings[s] > avg * 2) spikes++;
				}

				// Stability score (0-100)
				var stability = 100;
				if (jitter > 50) stability -= 30;
				else if (jitter > 20) stability -= 15;
				if (spikes > 2) stability -= 20;
				else if (spikes > 0) stability -= 10;
				if (failedCount > 3) stability -= 30;
				else if (failedCount > 0) stability -= failedCount * 5;
				if (max - min > 200) stability -= 20;
				else if (max - min > 100) stability -= 10;
				if (stability < 0) stability = 0;

				var issues = [];
				if (failedCount > 0) issues.push(failedCount + '/' + pingCount + ' pings failed');
				if (spikes > 0) issues.push(spikes + ' latency spikes detected (>' + (avg * 2) + 'ms)');
				if (jitter > 30) issues.push('High path jitter: ' + jitter + 'ms');
				if (max - min > 150) issues.push('Wide latency range: ' + min + '-' + max + 'ms');

				// NAT type estimation
				var natType = 'Unknown';
				if (iceInfo.candidateTypes.indexOf('relay') >= 0) {
					natType = 'Symmetric NAT (TURN relay needed)';
				} else if (iceInfo.candidateTypes.indexOf('srflx') >= 0) {
					natType = 'Cone NAT (direct connection OK)';
				} else if (iceInfo.candidateTypes.indexOf('host') >= 0) {
					natType = 'No NAT / Direct';
				}

				results.pathTrace = {
					ok: stability >= 50,
					samples: pingSamples,
					avg: avg,
					min: min,
					max: max,
					jitter: jitter,
					spikes: spikes,
					failedPings: failedCount,
					totalPings: pingCount,
					stability: stability,
					natType: natType,
					iceInfo: iceInfo,
					issues: issues
				};
				checkDone();
			}
		})();
	}

	// --- Smart Network Diagnosis ---
	function generateDiagnosis(r) {
		if (!r) return null;

		var diagnosis = { source: 'unknown', confidence: 'low', issues: [], suggestions: [] };

		// Gather metrics
		var wssTime = (r.wss && r.wss.ok) ? r.wss.time : -1;
		var localJitter = (r.jitterTest) ? r.jitterTest.jitter : -1;

		// Reference ping analysis
		var refAvg = -1, refOkCount = 0, refFailCount = 0;
		if (r.refPings && r.refPings.length > 0) {
			var refSum = 0, refCount = 0;
			for (var i = 0; i < r.refPings.length; i++) {
				if (r.refPings[i].ok) {
					refSum += r.refPings[i].time;
					refCount++;
					refOkCount++;
				} else {
					refFailCount++;
				}
			}
			if (refCount > 0) refAvg = Math.round(refSum / refCount);
		}

		// Demo call quality
		var demoMos = (r.demoCall && r.demoCall.mos) ? r.demoCall.mos : -1;
		var demoLoss = (r.demoCall && r.demoCall.packetLoss !== undefined) ? r.demoCall.packetLoss : -1;
		var demoJitter = (r.demoCall && r.demoCall.jitter !== undefined) ? r.demoCall.jitter : -1;
		var demoRtt = (r.demoCall && r.demoCall.rtt !== undefined) ? r.demoCall.rtt : -1;

		// === Diagnosis Logic ===

		// Case 1: All reference pings fail → user has no internet
		if (refFailCount >= 3 || (refFailCount >= 2 && refOkCount === 0)) {
			diagnosis.source = 'user';
			diagnosis.confidence = 'high';
			diagnosis.issues.push('Internet connection appears down or severely degraded');
			diagnosis.suggestions.push('Check your internet connection (WiFi/Ethernet)');
			diagnosis.suggestions.push('Try restarting your router or switching networks');
			return diagnosis;
		}

		// Case 2: Reference pings high → user's internet is slow
		if (refAvg > 200) {
			diagnosis.source = 'user';
			diagnosis.confidence = 'high';
			diagnosis.issues.push('High internet latency (' + refAvg + 'ms avg to major servers)');
			diagnosis.suggestions.push('Your internet connection is slow - switch to a wired connection if on WiFi');
			diagnosis.suggestions.push('Close bandwidth-heavy apps (streaming, downloads, video calls)');
			diagnosis.suggestions.push('Contact your ISP if the issue persists');
		} else if (refAvg > 100) {
			diagnosis.issues.push('Moderate internet latency (' + refAvg + 'ms avg)');
		}

		// Check reference ping packet loss
		if (r.refPings && r.refPings.length > 0) {
			var totalLoss = 0, totalPings = 0;
			for (var rli = 0; rli < r.refPings.length; rli++) {
				if (r.refPings[rli].lossPercent !== undefined) {
					totalLoss += r.refPings[rli].lossPercent;
					totalPings++;
				}
			}
			if (totalPings > 0) {
				var avgLoss = Math.round(totalLoss / totalPings);
				if (avgLoss > 30) {
					diagnosis.source = 'user';
					diagnosis.confidence = 'high';
					diagnosis.issues.push('High packet loss to internet servers (' + avgLoss + '% average)');
					diagnosis.suggestions.push('Your internet connection is dropping packets - check cable/WiFi signal');
				} else if (avgLoss > 10) {
					diagnosis.issues.push('Some packet loss to internet servers (' + avgLoss + '% average)');
					diagnosis.suggestions.push('Minor packet loss detected - may affect call quality');
				}
			}
		}

		// Case 3: Compare server latency vs reference
		// Use STUN RTT (true network latency) instead of WSS time (includes TLS handshake overhead)
		var serverRtt = (r.latency && r.latency.rtt > 0) ? r.latency.rtt : wssTime;
		if (serverRtt > 0 && refAvg > 0) {
			var serverToRefRatio = serverRtt / refAvg;
			if (serverToRefRatio > 3 && serverRtt > 300) {
				diagnosis.source = 'server';
				diagnosis.confidence = 'high';
				diagnosis.issues.push('VoIP server latency (' + serverRtt + 'ms) is much slower than internet baseline (' + refAvg + 'ms)');
				diagnosis.suggestions.push('The VoIP server may be overloaded or experiencing issues');
				diagnosis.suggestions.push('Contact your system administrator to check server health');
			} else if (serverToRefRatio > 2 && serverRtt > 150) {
				diagnosis.source = 'server';
				diagnosis.confidence = 'medium';
				diagnosis.issues.push('VoIP server latency (' + serverRtt + 'ms) is elevated vs internet baseline (' + refAvg + 'ms)');
				diagnosis.suggestions.push('Server may be under load or geographically distant');
			} else if (serverRtt > 300 && refAvg > 200) {
				diagnosis.source = 'user';
				diagnosis.confidence = 'medium';
				diagnosis.issues.push('Both server and internet latency are high');
				diagnosis.suggestions.push('Your overall network is slow - try a different network or wired connection');
			}
		}

		// Case 4: WSS fails but references pass
		if (r.wss && !r.wss.ok && refOkCount >= 2) {
			diagnosis.source = 'server';
			diagnosis.confidence = 'high';
			diagnosis.issues.push('Cannot reach VoIP server but internet works fine');
			diagnosis.suggestions.push('The VoIP server may be down or blocked by a firewall');
			diagnosis.suggestions.push('Check if port ' + (state.config ? state.config.wss_port : '7443') + ' is blocked');
			diagnosis.suggestions.push('Contact your administrator');
		}

		// Case 5: STUN fails
		if (r.stun && !r.stun.ok) {
			if (refOkCount >= 2) {
				diagnosis.issues.push('STUN server unreachable - NAT traversal will fail');
				diagnosis.suggestions.push('Your firewall may be blocking UDP traffic');
				diagnosis.suggestions.push('Try disabling VPN if you are using one');
			} else {
				diagnosis.source = 'user';
				diagnosis.issues.push('STUN failure likely due to poor connectivity');
			}
		}

		// Case 5b: TURN test analysis
		if (r.turn) {
			if (r.turn.ok) {
				// TURN works - good fallback available
				if (r.stun && !r.stun.ok) {
					diagnosis.suggestions.push('TURN relay is available as fallback for blocked STUN');
				}
			} else if (r.turn.error !== 'Not configured') {
				diagnosis.issues.push('TURN server unreachable: ' + (r.turn.error || 'Connection failed'));
				diagnosis.suggestions.push('Check TURN server configuration and firewall rules for port 3478/UDP and 5349/TCP');
			}
		}

		// Case 5c: TURN audio stability analysis
		if (r.turnAudio && !r.turnAudio.error) {
			if (r.turnAudio.packetLoss > 5) {
				diagnosis.issues.push('TURN relay has high packet loss (' + r.turnAudio.packetLoss + '%)');
				diagnosis.suggestions.push('TURN server may be overloaded or network path to TURN has issues');
			}
			if (r.turnAudio.jitter > 30) {
				diagnosis.issues.push('TURN relay has high jitter (' + r.turnAudio.jitter + 'ms)');
				diagnosis.suggestions.push('Audio quality through TURN relay may be degraded');
			}
			if (r.turnAudio.rating === 'poor') {
				diagnosis.source = diagnosis.source === 'unknown' ? 'server' : diagnosis.source;
				diagnosis.confidence = 'medium';
			}
		}

		// Case 6: High local jitter
		if (localJitter > 30) {
			diagnosis.source = diagnosis.source === 'unknown' ? 'user' : diagnosis.source;
			diagnosis.issues.push('High system jitter (' + localJitter + 'ms) - CPU may be overloaded');
			diagnosis.suggestions.push('Close unnecessary browser tabs and applications');
			diagnosis.suggestions.push('Disable browser extensions that may consume resources');
		}

		// Case 7: Demo call analysis
		if (demoMos > 0) {
			if (demoLoss > 5) {
				// High packet loss - determine cause
				if (refAvg > 0 && refAvg < 80 && wssTime > 0 && wssTime < 200) {
					// Good baseline but still losing packets → server or path issue
					diagnosis.source = 'server';
					diagnosis.confidence = 'medium';
					diagnosis.issues.push('Packet loss (' + demoLoss.toFixed(1) + '%) despite good connectivity - possible server congestion');
					diagnosis.suggestions.push('Ask your administrator to check server load and codec settings');
				} else {
					diagnosis.source = 'user';
					diagnosis.issues.push('Packet loss (' + demoLoss.toFixed(1) + '%) likely from unstable connection');
					diagnosis.suggestions.push('Use a wired Ethernet connection instead of WiFi');
					diagnosis.suggestions.push('Check for network congestion on your local network');
				}
			}
			if (demoJitter > 30 && localJitter <= 15) {
				// Network jitter (not CPU jitter)
				if (refAvg > 0 && refAvg < 80) {
					diagnosis.source = 'server';
					diagnosis.issues.push('Audio jitter (' + demoJitter + 'ms) on VoIP path but internet is stable');
				} else {
					diagnosis.source = 'user';
					diagnosis.issues.push('Audio jitter (' + demoJitter + 'ms) from unstable network');
					diagnosis.suggestions.push('Switch to a more stable network connection');
				}
			}
			if (demoRtt > 200 && refAvg > 0 && refAvg < 80) {
				diagnosis.source = 'server';
				diagnosis.issues.push('High call RTT (' + demoRtt + 'ms) but internet baseline is good (' + refAvg + 'ms)');
				diagnosis.suggestions.push('Server may be geographically distant or overloaded');
			}
		}

		// Case 8: Path trace analysis
		if (r.pathTrace && !r.pathTrace.error) {
			var pt = r.pathTrace;
			if (pt.stability < 50) {
				diagnosis.issues.push('Server path is unstable (stability: ' + pt.stability + '%)');
				if (refAvg > 0 && refAvg < 80) {
					diagnosis.source = 'server';
					diagnosis.confidence = 'high';
					diagnosis.suggestions.push('The route to the VoIP server has high instability despite good internet');
					diagnosis.suggestions.push('This may indicate routing issues or server-side network problems');
				} else {
					diagnosis.source = 'user';
					diagnosis.suggestions.push('Your network connection is unstable - try a wired connection');
				}
			}
			if (pt.failedPings > 3) {
				diagnosis.issues.push(pt.failedPings + ' of ' + pt.totalPings + ' server pings failed');
				diagnosis.suggestions.push('Packet loss to server is significant - connection may be unreliable');
			}
			if (pt.spikes > 2) {
				diagnosis.issues.push('Multiple latency spikes detected on server path');
				if (refAvg > 0 && refAvg < 80) {
					diagnosis.source = 'server';
					diagnosis.suggestions.push('Spikes suggest congestion or routing changes on the path to the server');
				}
			}
			if (pt.natType && pt.natType.indexOf('Symmetric') >= 0) {
				var turnWorking = r.turn && r.turn.ok;
				var turnAudioOk = r.turnAudio && !r.turnAudio.error && r.turnAudio.ok;
				if (turnWorking && turnAudioOk) {
					diagnosis.issues.push('Symmetric NAT detected - TURN relay active and working');
				} else if (turnWorking) {
					diagnosis.issues.push('Symmetric NAT detected - TURN relay available');
				} else {
					diagnosis.issues.push('Symmetric NAT detected - may cause audio issues');
					diagnosis.suggestions.push('Configure a TURN server for reliable media relay through symmetric NAT');
				}
			}
		}

		// Case 9: Bandwidth analysis
		var demoBitrateIn = (r.demoCall && r.demoCall.bitrate) ? r.demoCall.bitrate : -1;
		var demoBitrateOut = (r.demoCall && r.demoCall.bitrateOut) ? r.demoCall.bitrateOut : -1;
		var demoAvailBw = (r.demoCall && r.demoCall.availableBandwidth) ? r.demoCall.availableBandwidth : -1;
		if (demoBitrateIn > 0 && demoBitrateIn < 20) {
			diagnosis.issues.push('Download bitrate very low (' + demoBitrateIn + ' kbps)');
			diagnosis.suggestions.push('Audio quality will be degraded - check for bandwidth-consuming apps');
		}
		if (demoBitrateOut > 0 && demoBitrateOut < 20) {
			diagnosis.issues.push('Upload bitrate very low (' + demoBitrateOut + ' kbps)');
			diagnosis.suggestions.push('Your upload speed may be insufficient - close uploading apps or switch networks');
		}
		if (demoAvailBw > 0 && demoAvailBw < 50) {
			diagnosis.source = diagnosis.source === 'unknown' ? 'user' : diagnosis.source;
			diagnosis.issues.push('Available bandwidth critically low (' + demoAvailBw + ' kbps)');
			diagnosis.suggestions.push('VoIP needs at least 80-100 kbps - check your internet speed');
		}

		// Case 9: Audio/mic test analysis
		var audioTest = (r.demoCall && r.demoCall.audioTest) ? r.demoCall.audioTest : null;
		if (audioTest) {
			if (!audioTest.mic.ok) {
				diagnosis.source = 'user';
				diagnosis.confidence = 'high';
				diagnosis.issues.push('Microphone is not capturing audio');
				diagnosis.suggestions.push('Check that the correct microphone is selected in Audio Settings');
				diagnosis.suggestions.push('Ensure browser microphone permission is granted');
				diagnosis.suggestions.push('Try a different microphone or check physical connections');
			} else if (audioTest.mic.rating === 'weak') {
				diagnosis.issues.push('Microphone signal is weak');
				diagnosis.suggestions.push('Move closer to the microphone or increase mic gain in system settings');
			}
			if (audioTest.mic.ok && !audioTest.spk.ok) {
				diagnosis.issues.push('One-way audio detected: mic works but no echo received from server');
				diagnosis.suggestions.push('Server may have an audio processing issue or codec mismatch');
				diagnosis.suggestions.push('Check FreeSWITCH echo extension (*9196) is working correctly');
			}
			if (!audioTest.mic.ok && audioTest.spk.ok) {
				diagnosis.source = 'user';
				diagnosis.issues.push('One-way audio: server sends audio but mic is silent');
				diagnosis.suggestions.push('This is a local microphone issue, not a network problem');
			}
			if (audioTest.mic.ok && audioTest.spk.ok && audioTest.mic.activePercent < 40) {
				diagnosis.issues.push('Intermittent microphone input (' + audioTest.mic.activePercent + '% active)');
				diagnosis.suggestions.push('Check for mic auto-muting or noise suppression interfering');
			}
			if (audioTest.spk.ok && audioTest.spk.activePercent < 30) {
				diagnosis.issues.push('Intermittent echo return (' + audioTest.spk.activePercent + '% active)');
				if (refAvg > 0 && refAvg < 80) {
					diagnosis.suggestions.push('Server may be dropping audio packets intermittently');
				} else {
					diagnosis.suggestions.push('Unstable network causing audio dropouts');
				}
			}
		}

		// If no issues found, or only informational (TURN relay active), all good
		var realIssues = diagnosis.issues.filter(function(i) { return i.indexOf('TURN relay active') < 0 && i.indexOf('TURN relay available') < 0; });
		if (realIssues.length === 0) {
			diagnosis.source = 'none';
			diagnosis.confidence = 'high';
			if (diagnosis.issues.length === 0) {
				diagnosis.issues.push('No issues detected');
			}
			diagnosis.suggestions = ['Network is in good condition for VoIP calls'];
		}

		// Set confidence if not already high
		if (diagnosis.confidence === 'low' && diagnosis.issues.length > 0) {
			diagnosis.confidence = refAvg > 0 ? 'medium' : 'low';
		}

		return diagnosis;
	}

	// Demo call test: calls FreeSWITCH echo extension *9196, collects RTP stats for ~8s, hangs up
	function runDemoCallTest() {
		var results = state.networkTestResults;
		if (!state.ua || !state.registered || state.currentSession) {
			results.demoCall = { ok: false, error: state.currentSession ? 'Call already active' : 'Not registered' };
			state.networkTestRunning = false;
			renderPhone();
			return;
		}

		results.demoCall = { status: 'calling', ok: false };
		renderPhone();

		var domain = state.config.domain;
		var echoURI = 'sip:*9196@' + domain;
		var demoSession = null;
		var demoPC = null;
		var demoTimeout = null;
		var statsCollected = [];
		// Audio analysis state
		var demoAudioCtx = null;
		var demoMicAnalyser = null;
		var demoSpkAnalyser = null;
		var micLevelSamples = [];
		var spkLevelSamples = [];
		var audioSampleInterval = null;

		function cleanupDemoAudio() {
			if (audioSampleInterval) { clearInterval(audioSampleInterval); audioSampleInterval = null; }
			if (demoAudioCtx) { try { demoAudioCtx.close(); } catch (e) {} demoAudioCtx = null; }
			demoMicAnalyser = null;
			demoSpkAnalyser = null;
		}

		function finishDemoTest(result) {
			if (demoTimeout) { clearTimeout(demoTimeout); demoTimeout = null; }
			cleanupDemoAudio();
			// Attach audio analysis to result
			if (micLevelSamples.length > 0 || spkLevelSamples.length > 0) {
				result.audioTest = analyzeAudioLevels(micLevelSamples, spkLevelSamples);
			}
			try { if (demoSession) demoSession.terminate(); } catch (e) {}
			demoSession = null;
			demoPC = null;
			results.demoCall = result;
			results.diagnosis = generateDiagnosis(results);
			state.networkTestRunning = false;
			renderPhone();
		}

		// Absolute timeout - 15s max
		demoTimeout = setTimeout(function () {
			finishDemoTest({ ok: false, error: 'Demo call timeout (15s)' });
		}, 15000);

		var statsStarted = false;

		function startStatsCollection() {
			if (statsStarted) return;
			statsStarted = true;
			results.demoCall = { status: 'connected', ok: false };
			renderPhone();

			// Get peer connection from event or session fallback
			if (!demoPC && demoSession && demoSession.connection) demoPC = demoSession.connection;

			// Audio level sampling every 200ms
			audioSampleInterval = setInterval(function () {
				micLevelSamples.push(getDemoAnalyserLevel(demoMicAnalyser));
				spkLevelSamples.push(getDemoAnalyserLevel(demoSpkAnalyser));
			}, 200);

			// Collect stats for 8 seconds
			var statsCount = 0;
			var prevBytesRecv = 0, prevBytesSent = 0, prevTimestamp = 0;
			var statsInterval = setInterval(function () {
				if (!demoPC && demoSession && demoSession.connection) demoPC = demoSession.connection;
				if (!demoPC || !demoPC.getStats) {
					statsCount++;
					if (statsCount >= 8) { clearInterval(statsInterval); finishDemoTest(analyzeDemoStats(statsCollected)); }
					return;
				}
				demoPC.getStats().then(function (stats) {
					var inbound = null, outbound = null, pair = null;
					stats.forEach(function (r) {
						// No kind/isRemote filter: voice-only call has exactly one inbound and one outbound RTP stream
						if (r.type === 'inbound-rtp' || r.type === 'ssrc') inbound = r;
						if (r.type === 'outbound-rtp') outbound = r;
						if (r.type === 'candidate-pair' && (r.nominated || r.state === 'succeeded')) { if (!pair || r.nominated) pair = r; }
					});
						if (!inbound) { var _t=[]; stats.forEach(function(r){_t.push(r.type+"/"+r.kind);}); console.warn("[EchoTest] No inbound-rtp. Types:", _t); }
					if (inbound) {
						var sample = {
							jitter: (inbound.jitter || 0) * 1000,
							packetsLost: inbound.packetsLost || 0,
							packetsReceived: inbound.packetsReceived || 0,
							bytesReceived: inbound.bytesReceived || 0,
							packetsSent: outbound ? (outbound.packetsSent || 0) : 0,
							bytesSent: outbound ? (outbound.bytesSent || 0) : 0,
							rtt: pair ? (pair.currentRoundTripTime || 0) * 1000 : 0,
							availableOutgoingBitrate: pair ? (pair.availableOutgoingBitrate || 0) : 0,
							timestamp: inbound.timestamp || Date.now()
						};
						if (prevTimestamp > 0) {
							var dt = (sample.timestamp - prevTimestamp) / 1000;
							if (dt > 0) {
								sample.bitrateIn = Math.round(((sample.bytesReceived - prevBytesRecv) * 8) / dt / 1000);
								sample.bitrateOut = Math.round(((sample.bytesSent - prevBytesSent) * 8) / dt / 1000);
							}
						}
						prevBytesRecv = sample.bytesReceived;
						prevBytesSent = sample.bytesSent;
						prevTimestamp = sample.timestamp;
						statsCollected.push(sample);
					}
					statsCount++;
					if (statsCount >= 8) {
						clearInterval(statsInterval);
						finishDemoTest(analyzeDemoStats(statsCollected));
					}
				}).catch(function () {
					statsCount++;
					if (statsCount >= 8) { clearInterval(statsInterval); finishDemoTest(analyzeDemoStats(statsCollected)); }
				});
			}, 1000);
		}

		var eventHandlers = {
			'peerconnection': function (data) {
				demoPC = data.peerconnection;
				demoPC.ontrack = function (evt) {
					try {
						var AudioCtx = window.AudioContext || window.webkitAudioContext;
						if (!AudioCtx) return;
						demoAudioCtx = new AudioCtx();
						if (evt.streams && evt.streams[0]) {
							var spkSource = demoAudioCtx.createMediaStreamSource(evt.streams[0]);
							demoSpkAnalyser = demoAudioCtx.createAnalyser();
							demoSpkAnalyser.fftSize = 256;
							spkSource.connect(demoSpkAnalyser);
						}
						var senders = demoPC.getSenders();
						for (var si = 0; si < senders.length; si++) {
							if (senders[si].track && senders[si].track.kind === 'audio') {
								var micStream = new MediaStream([senders[si].track]);
								var micSource = demoAudioCtx.createMediaStreamSource(micStream);
								demoMicAnalyser = demoAudioCtx.createAnalyser();
								demoMicAnalyser.fftSize = 256;
								micSource.connect(demoMicAnalyser);
								break;
							}
						}
					} catch (e) { console.warn('Demo audio analyser setup failed:', e); }
				};
			},
			'accepted': function () { startStatsCollection(); },
			'confirmed': function () { startStatsCollection(); },
			'ended': function (data) {
				if (statsStarted) {
					// Call ended while collecting — finishDemoTest will be called by stats interval
				} else {
					finishDemoTest({ ok: false, error: 'Call ended: ' + (data.cause || 'unknown') });
				}
			},
			'failed': function (data) {
				finishDemoTest({ ok: false, error: 'Call failed: ' + (data.cause || 'unknown') });
			},
			'getusermediafailed': function () {
				finishDemoTest({ ok: false, error: 'Microphone access denied' });
			}
		};

		try {
			demoSession = state.ua.call(echoURI, {
				eventHandlers: eventHandlers,
				mediaConstraints: getMicConstraints(),
				pcConfig: { iceServers: getICEServers() },
				rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false }
			});
		} catch (e) {
			finishDemoTest({ ok: false, error: 'Call exception: ' + e.message });
		}
	}

	function getDemoAnalyserLevel(analyser) {
		if (!analyser) return 0;
		var data = new Uint8Array(analyser.frequencyBinCount);
		analyser.getByteFrequencyData(data);
		var sum = 0;
		for (var i = 0; i < data.length; i++) sum += data[i];
		var avg = sum / data.length;
		return Math.min(100, Math.round((avg / 128) * 100));
	}

	function analyzeAudioLevels(micSamples, spkSamples) {
		var result = { mic: {}, spk: {}, echoDetected: false, issues: [] };

		// Mic analysis
		var micSum = 0, micMax = 0, micAboveThreshold = 0;
		for (var i = 0; i < micSamples.length; i++) {
			micSum += micSamples[i];
			if (micSamples[i] > micMax) micMax = micSamples[i];
			if (micSamples[i] > 3) micAboveThreshold++;
		}
		var micAvg = micSamples.length > 0 ? Math.round(micSum / micSamples.length) : 0;
		var micActivePercent = micSamples.length > 0 ? Math.round((micAboveThreshold / micSamples.length) * 100) : 0;
		result.mic = { avg: micAvg, max: micMax, activePercent: micActivePercent, samples: micSamples.length };
		result.mic.ok = micAvg > 2 || micMax > 10;
		result.mic.rating = micAvg >= 15 ? 'strong' : (micAvg >= 5 ? 'normal' : (micMax > 10 ? 'weak' : 'silent'));

		// Speaker analysis
		var spkSum = 0, spkMax = 0, spkAboveThreshold = 0;
		for (var j = 0; j < spkSamples.length; j++) {
			spkSum += spkSamples[j];
			if (spkSamples[j] > spkMax) spkMax = spkSamples[j];
			if (spkSamples[j] > 3) spkAboveThreshold++;
		}
		var spkAvg = spkSamples.length > 0 ? Math.round(spkSum / spkSamples.length) : 0;
		var spkActivePercent = spkSamples.length > 0 ? Math.round((spkAboveThreshold / spkSamples.length) * 100) : 0;
		result.spk = { avg: spkAvg, max: spkMax, activePercent: spkActivePercent, samples: spkSamples.length };
		result.spk.ok = spkAvg > 2 || spkMax > 10;
		result.spk.rating = spkAvg >= 15 ? 'strong' : (spkAvg >= 5 ? 'normal' : (spkMax > 10 ? 'weak' : 'silent'));

		// Echo detection: if mic is active AND speaker received audio back, echo path works
		result.echoDetected = result.mic.ok && result.spk.ok;

		// Issue detection
		if (result.mic.rating === 'silent') {
			result.issues.push('Microphone silent - no audio captured');
		} else if (result.mic.rating === 'weak') {
			result.issues.push('Microphone signal weak (avg level: ' + micAvg + '%)');
		}

		if (result.spk.rating === 'silent') {
			if (result.mic.ok) {
				result.issues.push('No echo received - server may not be returning audio');
			} else {
				result.issues.push('No audio received (mic also silent)');
			}
		} else if (result.spk.rating === 'weak') {
			result.issues.push('Echo return signal weak (avg level: ' + spkAvg + '%)');
		}

		if (result.mic.ok && !result.spk.ok) {
			result.issues.push('One-way audio: mic works but no sound from server');
		} else if (!result.mic.ok && result.spk.ok) {
			result.issues.push('One-way audio: receiving server audio but mic is not working');
		}

		// Audio clipping detection
		if (micMax >= 95) {
			result.issues.push('Mic audio may be clipping (peak: ' + micMax + '%) - lower mic gain');
		}
		if (spkMax >= 95) {
			result.issues.push('Speaker audio may be clipping (peak: ' + spkMax + '%)');
		}

		// Intermittent audio
		if (result.mic.ok && micActivePercent < 40) {
			result.issues.push('Mic audio is intermittent (active only ' + micActivePercent + '% of the time)');
		}
		if (result.spk.ok && spkActivePercent < 30) {
			result.issues.push('Echo audio is intermittent (received only ' + spkActivePercent + '% of the time)');
		}

		result.ok = result.mic.ok && result.spk.ok && result.issues.length === 0;

		return result;
	}

	function analyzeDemoStats(samples) {
		if (samples.length === 0) return { ok: false, error: 'No RTP stats collected' };

		var n = samples.length;
		var last = samples[n - 1];

		// Aggregate metrics
		var totalPackets = last.packetsReceived;
		var totalLost = last.packetsLost;
		var packetLoss = totalPackets > 0 ? (totalLost / (totalPackets + totalLost)) * 100 : 0;
		if (packetLoss < 0) packetLoss = 0;

		var avgJitter = 0, avgRtt = 0, avgBitrate = 0, bitrateCount = 0;
		var avgBitrateOut = 0, bitrateOutCount = 0;
		var totalSent = last.packetsSent || 0;
		var totalBytesSent = last.bytesSent || 0;
		var availBw = 0, availBwCount = 0;
		for (var i = 0; i < n; i++) {
			avgJitter += samples[i].jitter;
			avgRtt += samples[i].rtt;
			if (samples[i].bitrateIn > 0) { avgBitrate += samples[i].bitrateIn; bitrateCount++; }
			if (samples[i].bitrateOut > 0) { avgBitrateOut += samples[i].bitrateOut; bitrateOutCount++; }
			if (samples[i].availableOutgoingBitrate > 0) { availBw += samples[i].availableOutgoingBitrate; availBwCount++; }
		}
		avgJitter = Math.round(avgJitter / n);
		avgRtt = Math.round(avgRtt / n);
		avgBitrate = bitrateCount > 0 ? Math.round(avgBitrate / bitrateCount) : 0;
		avgBitrateOut = bitrateOutCount > 0 ? Math.round(avgBitrateOut / bitrateOutCount) : 0;
		var avgAvailBw = availBwCount > 0 ? Math.round(availBw / availBwCount / 1000) : 0; // kbps

		var audioReceived = totalPackets > 10;
		var mos = calculateMOS(avgRtt, avgJitter, packetLoss);
		var rating = mosToRating(mos);

		var issues = [];
		if (!audioReceived) issues.push('No audio received from server');
		if (packetLoss > 5) issues.push('High packet loss: ' + packetLoss.toFixed(1) + '%');
		else if (packetLoss > 1) issues.push('Packet loss: ' + packetLoss.toFixed(1) + '%');
		if (avgJitter > 50) issues.push('High jitter: ' + avgJitter + 'ms');
		else if (avgJitter > 20) issues.push('Elevated jitter: ' + avgJitter + 'ms');
		if (avgRtt > 300) issues.push('High latency: ' + avgRtt + 'ms');
		else if (avgRtt > 150) issues.push('Elevated latency: ' + avgRtt + 'ms');
		if (avgBitrate > 0 && avgBitrate < 20) issues.push('Low download bitrate: ' + avgBitrate + ' kbps');
		if (avgBitrateOut > 0 && avgBitrateOut < 20) issues.push('Low upload bitrate: ' + avgBitrateOut + ' kbps');
		if (avgAvailBw > 0 && avgAvailBw < 50) issues.push('Low available bandwidth: ' + avgAvailBw + ' kbps');

		return {
			ok: audioReceived && packetLoss < 10,
			audioReceived: audioReceived,
			packetsReceived: totalPackets,
			packetsSent: totalSent,
			packetLoss: Math.round(packetLoss * 10) / 10,
			jitter: avgJitter,
			rtt: avgRtt,
			bitrate: avgBitrate,
			bitrateOut: avgBitrateOut,
			availableBandwidth: avgAvailBw,
			mos: mos,
			rating: rating,
			issues: issues
		};
	}

	// --- Audio Level Monitoring ---

	function startAudioLevels() {
		stopAudioLevels();
		try {
			var AudioCtx = window.AudioContext || window.webkitAudioContext;
			if (!AudioCtx) return;
			state.audioLevelCtx = new AudioCtx();

			// Mic (local) chain: source → [AGC] → gain → destination + analyser
			if (state.currentSession && state.currentSession.connection) {
				var senders = state.currentSession.connection.getSenders();
				for (var i = 0; i < senders.length; i++) {
					if (senders[i].track && senders[i].track.kind === 'audio') {
						var micStream = new MediaStream([senders[i].track]);
						var micSource = state.audioLevelCtx.createMediaStreamSource(micStream);

						// Create gain node for mic volume control
						state.micGainNode = state.audioLevelCtx.createGain();
						state.micGainNode.gain.value = state.audioSettings.micVolume;

						// Create destination to get a processed output stream
						var micDest = state.audioLevelCtx.createMediaStreamDestination();

						// Build chain: source → [compressor] → gain → destination
						var micLastNode = micSource;
						if (state.audioSettings.micAGC) {
							state.micCompressor = createAGCCompressor(state.audioLevelCtx);
							micLastNode.connect(state.micCompressor);
							micLastNode = state.micCompressor;
						}
						micLastNode.connect(state.micGainNode);
						state.micGainNode.connect(micDest);

						// Replace the sender's track with the processed track
						var processedTrack = micDest.stream.getAudioTracks()[0];
						senders[i].replaceTrack(processedTrack).catch(function () {});

						// Analyser taps the output
						state.micAnalyser = state.audioLevelCtx.createAnalyser();
						state.micAnalyser.fftSize = 256;
						state.micGainNode.connect(state.micAnalyser);
						break;
					}
				}
			}

			// Speaker (remote) chain: source → [AGC] → gain → destination + analyser
			if (state.remoteAudio && state.remoteAudio.srcObject) {
				var spkSource = state.audioLevelCtx.createMediaStreamSource(state.remoteAudio.srcObject);

				if (state.audioSettings.spkAGC) {
					state.spkCompressor = createAGCCompressor(state.audioLevelCtx);
					state.spkGainNode = state.audioLevelCtx.createGain();
					state.spkGainNode.gain.value = 1.0;

					var spkDest = state.audioLevelCtx.createMediaStreamDestination();

					// Chain: source → compressor → gain → destination
					spkSource.connect(state.spkCompressor);
					state.spkCompressor.connect(state.spkGainNode);
					state.spkGainNode.connect(spkDest);

					// Replace remoteAudio source with AGC-processed stream
					state.remoteAudio.srcObject = spkDest.stream;
					state.remoteAudio.volume = state.audioSettings.speakerVolume;
					state.remoteAudio.play().catch(function () {});

					// Analyser on processed output
					state.spkAnalyser = state.audioLevelCtx.createAnalyser();
					state.spkAnalyser.fftSize = 256;
					state.spkGainNode.connect(state.spkAnalyser);
				} else {
					state.spkAnalyser = state.audioLevelCtx.createAnalyser();
					state.spkAnalyser.fftSize = 256;
					spkSource.connect(state.spkAnalyser);
				}
			}

			state.audioLevelInterval = setInterval(updateAudioLevels, 100);
		} catch (e) {
			console.warn('WebRTC Phone: Audio level monitoring failed', e);
		}
	}

	function stopAudioLevels() {
		if (state.audioLevelInterval) { clearInterval(state.audioLevelInterval); state.audioLevelInterval = null; }
		if (state.audioLevelCtx) {
			try { state.audioLevelCtx.close(); } catch (e) {}
			state.audioLevelCtx = null;
		}
		state.micAnalyser = null;
		state.spkAnalyser = null;
		state.micGainNode = null;
		state.spkGainNode = null;
		state.micCompressor = null;
		state.spkCompressor = null;
		state.micLevel = 0;
		state.spkLevel = 0;
	}

	function getAnalyserLevel(analyser) {
		if (!analyser) return 0;
		var data = new Uint8Array(analyser.frequencyBinCount);
		analyser.getByteFrequencyData(data);
		var sum = 0;
		for (var i = 0; i < data.length; i++) sum += data[i];
		var avg = sum / data.length;
		return Math.min(100, Math.round((avg / 128) * 100));
	}

	function updateAudioLevels() {
		state.micLevel = getAnalyserLevel(state.micAnalyser);
		state.spkLevel = getAnalyserLevel(state.spkAnalyser);

		var micBar = document.getElementById('webrtc-mic-level-bar');
		var spkBar = document.getElementById('webrtc-spk-level-bar');
		if (micBar) micBar.style.width = state.micLevel + '%';
		if (spkBar) spkBar.style.width = state.spkLevel + '%';
	}

	function renderNetRow(cls, icon, label, value) {
		return '<div class="webrtc-net-result ' + cls + '"><span class="webrtc-net-icon">' + icon + '</span><span class="webrtc-net-label">' + label + '</span><span class="webrtc-net-value">' + value + '</span></div>';
	}

	function renderNetworkTestPanel() {
		var html = '<div class="webrtc-network-test">';
		html += '<div class="webrtc-network-test-title">' + t('networkQualityTest') + '</div>';
		if (state.config && state.config.domain) {
			var displayPort = state.config.wss_port || '7443';
			html += '<div class="webrtc-net-domain">Server: ' + escapeHtml(state.config.domain) + (displayPort == '443' ? '/wss' : ':' + escapeHtml(displayPort)) + '</div>';
		}

		if (state.networkTestRunning) {
			html += '<div class="webrtc-network-test-running">' + t('runningTests') + '</div>';
		}

		var r = state.networkTestResults;
		if (r) {
			// ===== TWO-COLUMN LAYOUT =====
			html += '<div class="webrtc-net-columns">';

			// ===== LEFT COLUMN: Connectivity + Echo + Bandwidth + Audio =====
			html += '<div class="webrtc-net-col">';

			// WSS
			if (r.wss !== null) html += renderNetRow(r.wss.ok ? 'webrtc-net-pass' : 'webrtc-net-fail', r.wss.ok ? '&#10003;' : '&#10007;', t('wssServer'), r.wss.ok ? r.wss.time + 'ms' : escapeHtml(r.wss.error));
			// STUN
			if (r.stun !== null) html += renderNetRow(r.stun.ok ? 'webrtc-net-pass' : 'webrtc-net-fail', r.stun.ok ? '&#10003;' : '&#10007;', t('stunServer'), r.stun.ok ? r.stun.time + 'ms' + (r.stun.ip ? ' (' + escapeHtml(r.stun.ip) + ')' : '') : escapeHtml(r.stun.error));
			// TURN
			if (r.turn !== null) {
				if (r.turn.error === 'Not configured') {
					html += renderNetRow('webrtc-net-warn', '&#9888;', 'TURN Server', 'Not configured');
				} else {
					html += renderNetRow(r.turn.ok ? 'webrtc-net-pass' : 'webrtc-net-fail', r.turn.ok ? '&#10003;' : '&#10007;', 'TURN Server', r.turn.ok ? r.turn.time + 'ms' + (r.turn.relayIP ? ' (relay: ' + escapeHtml(r.turn.relayIP) + ')' : '') : escapeHtml(r.turn.error));
				}
			}
			// TURN Audio Stability
			if (r.turnAudio !== null) {
				if (r.turnAudio.error === 'TURN not configured') {
					html += renderNetRow('webrtc-net-warn', '&#9888;', 'TURN Audio', 'Not configured');
				} else if (r.turnAudio.error) {
					html += renderNetRow('webrtc-net-fail', '&#10007;', 'TURN Audio', escapeHtml(r.turnAudio.error));
				} else {
					var taRating = r.turnAudio.rating || 'unknown';
					var taClass = (taRating === 'excellent' || taRating === 'good') ? 'webrtc-net-pass' : (taRating === 'fair' ? 'webrtc-net-warn' : 'webrtc-net-fail');
					var taIcon = (taRating === 'excellent' || taRating === 'good') ? '&#10003;' : (taRating === 'fair' ? '&#9888;' : '&#10007;');
					html += renderNetRow(taClass, taIcon, 'TURN Audio', taRating.charAt(0).toUpperCase() + taRating.slice(1) + ' (loss:' + r.turnAudio.packetLoss + '% jitter:' + r.turnAudio.jitter + 'ms)');
					if (r.turnAudio.bitrate > 0) {
						html += '<div class="webrtc-net-demo-details"><span>Bitrate:' + r.turnAudio.bitrate + 'kbps</span><span>Packets:' + r.turnAudio.packetsReceived + '</span><span>Lost:' + r.turnAudio.packetsLost + '</span></div>';
					}
					if (r.turnAudio.issues && r.turnAudio.issues.length > 0) {
						html += '<div class="webrtc-net-demo-issues">';
						for (var tai = 0; tai < r.turnAudio.issues.length; tai++) html += '<span class="webrtc-quality-issue">' + escapeHtml(r.turnAudio.issues[tai]) + '</span>';
						html += '</div>';
					}
				}
			}
			// Latency
			if (r.latency !== null) {
				var latOk = r.latency.rtt > 0 && r.latency.rtt < 300;
				html += renderNetRow(r.latency.rtt > 0 ? (latOk ? 'webrtc-net-pass' : 'webrtc-net-warn') : 'webrtc-net-fail', r.latency.rtt > 0 ? (latOk ? '&#10003;' : '&#9888;') : '&#10007;', t('latency'), r.latency.rtt > 0 ? r.latency.rtt + 'ms' : escapeHtml(r.latency.error || 'N/A'));
			}
			// Jitter
			if (r.jitterTest !== null) html += renderNetRow(r.jitterTest.ok ? 'webrtc-net-pass' : 'webrtc-net-warn', r.jitterTest.ok ? '&#10003;' : '&#9888;', t('systemJitter'), r.jitterTest.jitter + 'ms');
			// SIP Ping
			if (r.sipPing !== null) html += renderNetRow(r.sipPing.ok ? 'webrtc-net-pass' : 'webrtc-net-fail', r.sipPing.ok ? '&#10003;' : '&#10007;', t('sipSignaling'), r.sipPing.ok ? r.sipPing.time + 'ms' : escapeHtml(r.sipPing.error || 'Failed'));

			// Demo Call
			if (r.demoCall !== null) {
				if (r.demoCall.status === 'calling') {
					html += renderNetRow('webrtc-net-warn', '&#8987;', t('echoTest'), t('dialingEcho'));
				} else if (r.demoCall.status === 'connected') {
					html += renderNetRow('webrtc-net-warn', '&#8987;', t('echoTest'), t('collectingStats'));
				} else if (r.demoCall.error) {
					html += renderNetRow('webrtc-net-fail', '&#10007;', t('echoTest'), escapeHtml(r.demoCall.error));
				} else {
					html += renderNetRow(r.demoCall.ok ? 'webrtc-net-pass' : 'webrtc-net-fail', r.demoCall.ok ? '&#10003;' : '&#10007;', t('echoTest'), r.demoCall.ok ? r.demoCall.rating.charAt(0).toUpperCase() + r.demoCall.rating.slice(1) + ' (MOS ' + r.demoCall.mos.toFixed(1) + ')' : 'Failed');
					if (r.demoCall.ok || r.demoCall.packetsReceived > 0) {
						html += '<div class="webrtc-net-demo-details">';
						html += '<span>' + t('recv') + ':' + r.demoCall.packetsReceived + '</span>';
						html += '<span>' + t('sent') + ':' + (r.demoCall.packetsSent || 0) + '</span>';
						html += '<span>' + t('loss') + ':' + r.demoCall.packetLoss + '%</span>';
						html += '<span>' + t('jitter') + ':' + r.demoCall.jitter + 'ms</span>';
						html += '<span>' + t('rtt') + ':' + r.demoCall.rtt + 'ms</span>';
						html += '</div>';
						// Bandwidth
						html += '<div class="webrtc-net-section-label">' + t('bandwidth') + ' (UDP)</div>';
						if (r.demoCall.bitrate > 0) {
							var dlOk = r.demoCall.bitrate >= 40;
							html += renderNetRow(dlOk ? 'webrtc-net-pass' : (r.demoCall.bitrate >= 20 ? 'webrtc-net-warn' : 'webrtc-net-fail'), dlOk ? '&#10003;' : '&#9888;', t('download'), r.demoCall.bitrate + ' kbps');
						}
						if (r.demoCall.bitrateOut > 0) {
							var ulOk = r.demoCall.bitrateOut >= 40;
							html += renderNetRow(ulOk ? 'webrtc-net-pass' : (r.demoCall.bitrateOut >= 20 ? 'webrtc-net-warn' : 'webrtc-net-fail'), ulOk ? '&#10003;' : '&#9888;', t('upload'), r.demoCall.bitrateOut + ' kbps');
						}
						if (r.demoCall.availableBandwidth > 0) {
							html += renderNetRow(r.demoCall.availableBandwidth >= 100 ? 'webrtc-net-pass' : 'webrtc-net-warn', r.demoCall.availableBandwidth >= 100 ? '&#10003;' : '&#9888;', t('available'), r.demoCall.availableBandwidth + ' kbps');
						}
					}
					if (r.demoCall.issues && r.demoCall.issues.length > 0) {
						html += '<div class="webrtc-net-demo-issues">';
						for (var di = 0; di < r.demoCall.issues.length; di++) html += '<span class="webrtc-quality-issue">' + escapeHtml(r.demoCall.issues[di]) + '</span>';
						html += '</div>';
					}
					// Audio/Mic Test
					if (r.demoCall.audioTest) {
						var at = r.demoCall.audioTest;
						html += '<div class="webrtc-net-section-label">' + t('audioMicTest') + '</div>';
						var micLbl = t(at.mic.rating) || at.mic.rating;
						html += renderNetRow(at.mic.ok ? (at.mic.rating === 'strong' || at.mic.rating === 'normal' ? 'webrtc-net-pass' : 'webrtc-net-warn') : 'webrtc-net-fail', at.mic.ok ? '&#10003;' : '&#10007;', t('microphone'), micLbl.charAt(0).toUpperCase() + micLbl.slice(1) + ' (' + at.mic.avg + '%/' + at.mic.max + '%)');
						var spkLbl = t(at.spk.rating) || at.spk.rating;
						html += renderNetRow(at.spk.ok ? (at.spk.rating === 'strong' || at.spk.rating === 'normal' ? 'webrtc-net-pass' : 'webrtc-net-warn') : 'webrtc-net-fail', at.spk.ok ? '&#10003;' : '&#10007;', t('echoReturn'), spkLbl.charAt(0).toUpperCase() + spkLbl.slice(1) + ' (' + at.spk.avg + '%/' + at.spk.max + '%)');
						html += renderNetRow(at.echoDetected ? 'webrtc-net-pass' : 'webrtc-net-fail', at.echoDetected ? '&#10003;' : '&#10007;', t('fullDuplex'), at.echoDetected ? t('twoWayAudio') : t('audioPathIncomplete'));
						if (at.issues && at.issues.length > 0) {
							html += '<div class="webrtc-net-demo-issues">';
							for (var ai = 0; ai < at.issues.length; ai++) html += '<span class="webrtc-quality-issue">' + escapeHtml(at.issues[ai]) + '</span>';
							html += '</div>';
						}
					}
				}
			}

			html += '</div>'; // end left column

			// ===== RIGHT COLUMN: Baseline + Path Trace + Diagnosis =====
			html += '<div class="webrtc-net-col">';

			// Reference pings
			if (r.refPings && r.refPings.length > 0) {
				html += '<div class="webrtc-net-section-label">' + t('internetBaseline') + '</div>';
				for (var rpi = 0; rpi < r.refPings.length; rpi++) {
					var rp = r.refPings[rpi];
					var rpOk = rp.ok && rp.time < 200;
					var detail = rp.ok ? rp.time + 'ms' : escapeHtml(rp.error || 'Failed');
					if (rp.lossPercent > 0) detail += ' (loss: ' + rp.loss + ')';
					html += renderNetRow(rp.ok ? (rpOk ? 'webrtc-net-pass' : 'webrtc-net-warn') : 'webrtc-net-fail', rp.ok ? (rpOk ? '&#10003;' : '&#9888;') : '&#10007;', escapeHtml(rp.name), detail);
				}
			}

			// Path Trace
			if (r.pathTrace && !state.networkTestRunning) {
				var pt = r.pathTrace;
				html += '<div class="webrtc-net-section-label">' + t('pathTrace') + '</div>';
				if (pt.error) {
					html += renderNetRow('webrtc-net-fail', '&#10007;', t('serverRoute'), escapeHtml(pt.error));
				} else {
					var stabClass = pt.stability >= 80 ? 'webrtc-net-pass' : (pt.stability >= 50 ? 'webrtc-net-warn' : 'webrtc-net-fail');
					html += renderNetRow(stabClass, pt.stability >= 80 ? '&#10003;' : (pt.stability >= 50 ? '&#9888;' : '&#10007;'), t('stability'), pt.stability + '% (' + (pt.stability >= 80 ? t('pathStable') : t('pathUnstable')) + ')');
					html += '<div class="webrtc-net-demo-details">';
					html += '<span>Avg:' + pt.avg + 'ms</span><span>Min:' + pt.min + 'ms</span><span>Max:' + pt.max + 'ms</span><span>' + t('jitter') + ':' + pt.jitter + 'ms</span>';
					if (pt.spikes > 0) html += '<span>Spikes:' + pt.spikes + '</span>';
					if (pt.failedPings > 0) html += '<span>Fail:' + pt.failedPings + '/' + pt.totalPings + '</span>';
					html += '</div>';
					// Ping timeline
					html += '<div class="webrtc-ping-timeline">';
					var _ptDomain = state.config ? state.config.domain : '';
					var _ptPublicIP = pt.iceInfo.publicIP || '';
					var _ptLocalIP = pt.iceInfo.localIP || '';
					for (var pi = 0; pi < pt.samples.length; pi++) {
						var ps = pt.samples[pi];
						var barH = ps.time > 0 ? Math.min(100, Math.max(5, Math.round((ps.time / (pt.max || 1)) * 100))) : 0;
						var barClass2 = ps.time < 0 ? 'webrtc-ping-bar-fail' : (ps.time > pt.avg * 2 ? 'webrtc-ping-bar-spike' : 'webrtc-ping-bar-ok');
						var barTip = 'Hop ' + ps.hop + ': ' + (ps.time > 0 ? ps.time + 'ms' : 'failed');
						barTip += '\nServer: ' + (_ptDomain || 'N/A');
						if (_ptPublicIP) barTip += '\nPublic IP: ' + _ptPublicIP;
						if (_ptLocalIP) barTip += '\nLocal IP: ' + _ptLocalIP;
						if (pt.natType) barTip += '\nNAT: ' + pt.natType;
						html += '<div class="webrtc-ping-bar ' + barClass2 + '" style="height:' + barH + '%" title="' + escapeHtml(barTip) + '"></div>';
					}
					html += '</div>';
					html += renderNetRow('webrtc-net-pass', '&#128270;', t('natType'), escapeHtml(pt.natType));
					if (pt.iceInfo.localIP || pt.iceInfo.publicIP) {
						html += '<div class="webrtc-net-demo-details">';
						if (pt.iceInfo.localIP) html += '<span>Local: ' + escapeHtml(pt.iceInfo.localIP) + '</span>';
						if (pt.iceInfo.publicIP) html += '<span>Public: ' + escapeHtml(pt.iceInfo.publicIP) + '</span>';
						html += '</div>';
					}
					if (pt.issues && pt.issues.length > 0) {
						html += '<div class="webrtc-net-demo-issues">';
						for (var pti = 0; pti < pt.issues.length; pti++) html += '<span class="webrtc-quality-issue">' + escapeHtml(pt.issues[pti]) + '</span>';
						html += '</div>';
					}
				}
			}

			// Smart Diagnosis
			if (r.diagnosis && !state.networkTestRunning) {
				var d = r.diagnosis;
				var sourceLabel = { user: t('yourNetwork'), server: t('voipServer'), none: t('noIssues'), unknown: t('undetermined') };
				var sourceIcon = { user: '&#128187;', server: '&#9729;', none: '&#10003;', unknown: '&#63;' };
				var diagClass = d.source === 'none' ? 'webrtc-net-verdict-pass' : (d.source === 'server' ? 'webrtc-net-verdict-fail' : 'webrtc-net-verdict-warn');
				html += '<div class="webrtc-net-diagnosis">';
				html += '<div class="webrtc-net-section-label">' + t('diagnosis') + '</div>';
				html += '<div class="webrtc-net-verdict ' + diagClass + '">';
				html += '<span class="webrtc-net-diag-source">' + (sourceIcon[d.source] || '') + ' ' + t('issueSource') + ': <strong>' + (sourceLabel[d.source] || t('undetermined')) + '</strong></span>';
				html += '</div>';
				if (d.issues.length > 0 && d.source !== 'none') {
					html += '<div class="webrtc-net-diag-list"><div class="webrtc-net-diag-heading">' + t('findings') + '</div>';
					for (var di2 = 0; di2 < d.issues.length; di2++) html += '<div class="webrtc-net-diag-item webrtc-net-diag-issue">' + escapeHtml(d.issues[di2]) + '</div>';
					html += '</div>';
				}
				if (d.suggestions.length > 0) {
					html += '<div class="webrtc-net-diag-list"><div class="webrtc-net-diag-heading">' + (d.source === 'none' ? '' : t('suggestedFixes')) + '</div>';
					for (var si = 0; si < d.suggestions.length; si++) html += '<div class="webrtc-net-diag-item webrtc-net-diag-fix">' + escapeHtml(d.suggestions[si]) + '</div>';
					html += '</div>';
				}
				html += '</div>';
			}

			html += '</div>'; // end right column
			html += '</div>'; // end columns
		}

		html += '<div class="webrtc-network-test-actions">';
		if (!state.networkTestRunning) {
			html += '<button class="webrtc-btn webrtc-btn-sm webrtc-btn-primary" onclick="WebRTCPhone.runNetworkTest()">' + (r ? t('reTest') : t('runTest')) + '</button>';
		}
		if (r && !state.networkTestRunning && r.diagnosis) {
			html += '<button class="webrtc-btn webrtc-btn-sm webrtc-btn-secondary" onclick="WebRTCPhone.downloadReportPDF()" title="' + t('downloadPDF') + '">&#128196; ' + t('downloadPDF') + '</button>';
			html += '<button id="webrtc-send-report-btn" class="webrtc-btn webrtc-btn-sm webrtc-btn-secondary" onclick="WebRTCPhone.sendReportEmail()" title="' + t('sendReport') + '">&#9993; ' + t('sendReport') + '</button>';
		}
		html += '<button class="webrtc-btn webrtc-btn-sm webrtc-btn-secondary" onclick="WebRTCPhone.closeNetworkTest()">' + t('close') + '</button>';
		html += '</div></div>';
		return html;
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

	function setMicVolume(vol) {
		vol = parseFloat(vol);
		if (isNaN(vol)) return;
		vol = Math.max(0, Math.min(1, vol));
		state.audioSettings.micVolume = vol;
		if (state.micGainNode) state.micGainNode.gain.value = vol;
		saveAudioSettings();
	}

	function toggleMicAGC(enabled) {
		state.audioSettings.micAGC = !!enabled;
		saveAudioSettings();
		// Re-apply audio chain if in a call
		if (state.currentSession && state.audioLevelCtx) {
			startAudioLevels();
		}
	}

	function toggleSpkAGC(enabled) {
		state.audioSettings.spkAGC = !!enabled;
		saveAudioSettings();
		// Re-apply audio chain if in a call
		if (state.currentSession && state.audioLevelCtx) {
			startAudioLevels();
		}
	}

	function createAGCCompressor(ctx) {
		var comp = ctx.createDynamicsCompressor();
		// AGC-style settings: low threshold, high ratio = normalizes volume
		comp.threshold.value = -35;  // Start compressing at -35dB
		comp.knee.value = 20;        // Soft knee for natural sound
		comp.ratio.value = 12;       // High ratio for strong normalization
		comp.attack.value = 0.003;   // Fast attack (3ms) to catch peaks
		comp.release.value = 0.25;   // 250ms release for smooth recovery
		return comp;
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
			return { audio: { deviceId: { ideal: micId } }, video: false };
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
		xhr.open('GET', '/app/web_phone2/webrtc_phone_api.php', true);
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

		var wssUrl = (wssPort == '443') ? 'wss://' + domain + '/wss' : 'wss://' + domain + ':' + wssPort;
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
			state.ua.on('disconnected', function () {
				state.registered = false;
				if (state.currentSession) { endCall(); } else { renderPhone(); }
			});
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

	// Reorder SDP to prefer a specific codec (e.g. 'PCMA' for G.711a)
	function preferCodec(sdp, codecName) {
		var lines = sdp.split('\r\n');
		var mLineIdx = -1;
		var codecPt = null;
		// Find the payload type for the desired codec
		for (var i = 0; i < lines.length; i++) {
			if (lines[i].indexOf('m=audio') === 0) mLineIdx = i;
			var match = lines[i].match(new RegExp('^a=rtpmap:(\\d+)\\s+' + codecName + '/', 'i'));
			if (match) codecPt = match[1];
		}
		if (mLineIdx === -1 || !codecPt) return sdp;
		// Reorder payload types in m= line to put preferred codec first
		var mParts = lines[mLineIdx].split(' ');
		// m=audio <port> <proto> <pt1> <pt2> ...
		var header = mParts.slice(0, 3);
		var pts = mParts.slice(3);
		var filtered = pts.filter(function (p) { return p !== codecPt; });
		filtered.unshift(codecPt);
		lines[mLineIdx] = header.concat(filtered).join(' ');
		return lines.join('\r\n');
	}

	function getICEServers() {
		var servers = [];
		if (state.config && state.config.stun_server) {
			servers.push({ urls: state.config.stun_server });
		}
		// Add TURN server if configured
		if (state.config && state.config.turn_server) {
			var turnConfig = { urls: state.config.turn_server };
			if (state.config.turn_username) turnConfig.username = state.config.turn_username;
			if (state.config.turn_password) turnConfig.credential = state.config.turn_password;
			servers.push(turnConfig);
			if (state.config.turn_server.indexOf('turn:') === 0) {
				var turnsConfig = { urls: state.config.turn_server.replace('turn:', 'turns:').replace(':3478', ':5349') };
				if (state.config.turn_username) turnsConfig.username = state.config.turn_username;
				if (state.config.turn_password) turnsConfig.credential = state.config.turn_password;
				servers.push(turnsConfig);
			}
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
				var pc = data.peerconnection;
				var iceCompleted = false;
				var srflxTimer = null;
				var absoluteTimer = setTimeout(function () {
					if (!iceCompleted) {
						iceCompleted = true; clearTimeout(srflxTimer);
						console.log('WebRTC Phone: ICE absolute timeout (10s), forcing completion');
						try { pc.dispatchEvent(new RTCPeerConnectionIceEvent('icecandidate', { candidate: null })); } catch (e) {}
					}
				}, 10000);
				pc.addEventListener('icecandidate', function (e) {
					if (!e.candidate) { iceCompleted = true; clearTimeout(srflxTimer); clearTimeout(absoluteTimer); return; }
					if ((e.candidate.type === 'srflx' || e.candidate.type === 'relay') && !iceCompleted) {
						clearTimeout(srflxTimer);
						clearTimeout(absoluteTimer);
						srflxTimer = setTimeout(function () {
							if (!iceCompleted) { iceCompleted = true; try { pc.dispatchEvent(new RTCPeerConnectionIceEvent('icecandidate', { candidate: null })); } catch (e) {} }
						}, 500);
					}
				});
				pc.addEventListener('iceconnectionstatechange', function () {
					console.log('WebRTC Phone: ICE connection state:', pc.iceConnectionState);
					if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
						pc.getStats().then(function (stats) {
							stats.forEach(function (r) {
								if (r.type === 'candidate-pair') console.log('WebRTC Phone: ICE pair state:', r.state, 'nominated:', r.nominated, 'bytesSent:', r.bytesSent, 'bytesReceived:', r.bytesReceived);
								if (r.type === 'local-candidate') console.log('WebRTC Phone: local candidate:', r.candidateType, r.ip || r.address, r.port, r.protocol);
								if (r.type === 'remote-candidate') console.log('WebRTC Phone: remote candidate:', r.candidateType, r.ip || r.address, r.port, r.protocol);
							});
						}).catch(function () {});
					}
				});
				pc.addEventListener('connectionstatechange', function () {
					console.log('WebRTC Phone: Peer connection state:', pc.connectionState);
					if (pc.connectionState === 'connected' && state.callState === 'in_call' && !state.callTimer) startCallTimer();
				});
				pc.ontrack = function (event) {
					console.log('WebRTC Phone: ontrack fired', event.track && event.track.kind, 'streams:', event.streams && event.streams.length);
					if (event.streams && event.streams[0]) {
						state.remoteAudio.srcObject = event.streams[0];
					} else if (event.track) {
						if (!state.remoteAudio.srcObject) state.remoteAudio.srcObject = new MediaStream();
						state.remoteAudio.srcObject.addTrack(event.track);
					}
					state.remoteAudio.play().catch(function (e) { console.warn('WebRTC Phone: audio play failed', e); });
				};
			},
			'accepted': function (data) {
				console.log('WebRTC Phone: call accepted', data);
				if (data && data.response && data.response.body) {
					console.log('WebRTC Phone: remote SDP (answer):\n' + data.response.body);
				}
				if (state.currentCallRecord) state.currentCallRecord.status = 'answered';
				state.callState = 'in_call'; stopRingtone(); hideFABBadge(); renderPhone();
			},
			'confirmed': function (data) {
				console.log('WebRTC Phone: call confirmed', data);
				if (state.currentCallRecord) state.currentCallRecord.status = 'answered';
				state.callState = 'in_call'; stopRingtone(); hideFABBadge();
				if (state.currentSession && !state.remoteAudio.srcObject) attachRemoteAudio(state.currentSession);
				renderPhone();
			},
			'ended': function (data) { console.log('WebRTC Phone: call ended', data.cause); endCall(); },
			'failed': function (data) {
				console.error('WebRTC Phone: call failed', data.cause);
				if (state.currentCallRecord && state.currentCallRecord.status !== 'answered') state.currentCallRecord.status = 'failed';
				endCall();
			},
			'getusermediafailed': function (data) { console.error('WebRTC Phone: getUserMedia failed', data); endCall(); }
		};

		var options = {
			eventHandlers: eventHandlers,
			mediaConstraints: getMicConstraints(),
			pcConfig: { iceServers: getICEServers() },
			rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false }
		};

		state.currentCallRecord = { direction: 'outbound', number: target, name: '', timestamp: Date.now(), status: 'cancelled' };

		try {
			state.currentSession = state.ua.call(targetURI, options);

			state.currentSession.on('sdp', function (ev) {
				// Prefer G.711a (PCMA) codec by reordering SDP offer
				if (ev.type === 'offer') {
					ev.sdp = preferCodec(ev.sdp, 'PCMA');
				}
				// Add ice-lite to FS answer SDP for ICE compatibility
				if (ev.type === 'answer' && ev.sdp.indexOf('a=ice-lite') === -1) {
					ev.sdp = ev.sdp.replace(/(m=audio)/, 'a=ice-lite\r\n$1');
				}
			});

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
		var inNum = '', inName = '';
		try {
			var remote = session.remote_identity;
			if (remote) {
				inNum = remote.uri ? remote.uri.user : '';
				inName = remote.display_name || '';
			}
		} catch (e) {}
		state.currentCallRecord = { direction: 'inbound', number: inNum, name: inName, timestamp: Date.now(), status: 'missed' };
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
		state.callState = 'in_call';
		renderPhone();
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
		if (state.currentCallRecord) state.currentCallRecord.status = 'rejected';
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
		try {
			if (state.muted) { state.currentSession.mute({ audio: true }); }
			else { state.currentSession.unmute({ audio: true }); }
		} catch (e) { state.muted = !state.muted; }
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
		// SDP modifications for ICE compatibility and codec preference
		session.on('sdp', function (ev) {
			// For incoming calls: prefer PCMA in our answer only (not the remote offer)
			if (ev.type === 'answer') {
				ev.sdp = preferCodec(ev.sdp, 'PCMA');
				if (ev.sdp.indexOf('a=ice-lite') === -1) {
					ev.sdp = ev.sdp.replace(/(m=audio)/, 'a=ice-lite\r\n$1');
				}
			}
		});
		session.on('accepted', function () {
			if (state.currentCallRecord) state.currentCallRecord.status = 'answered';
			state.callState = 'in_call'; stopRingtone(); hideFABBadge(); renderPhone();
		});
		session.on('confirmed', function () {
			if (state.currentCallRecord) state.currentCallRecord.status = 'answered';
			state.callState = 'in_call'; stopRingtone(); hideFABBadge(); if (!state.remoteAudio.srcObject) attachRemoteAudio(session);
			renderPhone();
		});
		session.on('ended', function () { endCall(); });
		session.on('failed', function (e) { console.log('WebRTC Phone: Call failed/ended', e.cause); endCall(); });
		session.on('getusermediafailed', function (e) { console.error('WebRTC Phone: Microphone access failed', e); endCall(); });
		session.on('peerconnection', function (data) {
			var pc = data.peerconnection;
			var iceCompleted = false;
			var srflxTimer = null;
			var absoluteTimer = setTimeout(function () {
				if (!iceCompleted) {
					iceCompleted = true; clearTimeout(srflxTimer);
					console.log('WebRTC Phone: ICE absolute timeout (10s), forcing completion');
					try { pc.dispatchEvent(new RTCPeerConnectionIceEvent('icecandidate', { candidate: null })); } catch (e) {}
				}
			}, 10000);
			pc.addEventListener('icecandidate', function (e) {
				if (!e.candidate) { iceCompleted = true; clearTimeout(srflxTimer); clearTimeout(absoluteTimer); return; }
				if ((e.candidate.type === 'srflx' || e.candidate.type === 'relay') && !iceCompleted) {
					clearTimeout(srflxTimer);
					clearTimeout(absoluteTimer);
					srflxTimer = setTimeout(function () {
						if (!iceCompleted) { iceCompleted = true; try { pc.dispatchEvent(new RTCPeerConnectionIceEvent('icecandidate', { candidate: null })); } catch (e) {} }
					}, 500);
				}
			});
			pc.addEventListener('iceconnectionstatechange', function () {
				console.log('WebRTC Phone: ICE connection state:', pc.iceConnectionState);
				if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
					pc.getStats().then(function (stats) {
						stats.forEach(function (r) {
							if (r.type === 'candidate-pair') console.log('WebRTC Phone: ICE pair state:', r.state, 'nominated:', r.nominated, 'bytesSent:', r.bytesSent, 'bytesReceived:', r.bytesReceived);
							if (r.type === 'local-candidate') console.log('WebRTC Phone: local candidate:', r.candidateType, r.ip || r.address, r.port, r.protocol);
							if (r.type === 'remote-candidate') console.log('WebRTC Phone: remote candidate:', r.candidateType, r.ip || r.address, r.port, r.protocol);
						});
					}).catch(function () {});
				}
			});
			pc.addEventListener('connectionstatechange', function () {
				console.log('WebRTC Phone: Peer connection state:', pc.connectionState);
				if (pc.connectionState === 'connected' && state.callState === 'in_call' && !state.callTimer) startCallTimer();
			});
			pc.ontrack = function (event) {
				console.log('WebRTC Phone: ontrack fired', event.track && event.track.kind, 'streams:', event.streams && event.streams.length);
				if (event.streams && event.streams[0]) {
					state.remoteAudio.srcObject = event.streams[0];
				} else if (event.track) {
					if (!state.remoteAudio.srcObject) state.remoteAudio.srcObject = new MediaStream();
					state.remoteAudio.srcObject.addTrack(event.track);
				}
				state.remoteAudio.play().catch(function (e) { console.warn('WebRTC Phone: audio play failed', e); });
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
				icon: '/app/web_phone2/resources/images/phone-icon.svg',
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
		if (state.currentCallRecord) {
			if (state.currentCallRecord.status === 'answered') {
				state.currentCallRecord.duration = state.callDuration;
				var qSummary = getCallQualitySummary();
				if (qSummary) state.currentCallRecord.quality = qSummary;
			}
			addCallToHistory(state.currentCallRecord);
			state.currentCallRecord = null;
		}
		stopQualityMonitor();
		stopAudioLevels();
		// Reset header color to default
		var headerEl = document.querySelector('.webrtc-phone-header');
		if (headerEl) headerEl.style.background = '';
		state.qualityStats = null;
		state.qualityHistory = [];
		state.prevStats = null;
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
		startQualityMonitor();
		// Delay audio levels slightly to ensure streams are attached
		setTimeout(function () { startAudioLevels(); }, 1000);
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
		html += '<span class="webrtc-phone-title">' + t('phone') + '</span>';
		html += '<button class="webrtc-close-btn" onclick="WebRTCPhone.toggle()" title="' + t('close') + '">&times;</button>';
		html += '</div>';
		html += '<div class="webrtc-phone-body webrtc-ext-selector">';
		html += '<label for="webrtc-ext-select">' + t('selectExtension') + ':</label>';
		html += '<select id="webrtc-ext-select" class="webrtc-select">';
		html += '<option value="">-- ' + t('selectExtension') + ' --</option>';
		for (var i = 0; i < state.extensions.length; i++) {
			var ext = state.extensions[i];
			var label = ext.extension;
			if (ext.description) label += ' - ' + ext.description;
			if (ext.caller_id_name && ext.caller_id_name !== ext.extension) label += ' (' + ext.caller_id_name + ')';
			html += '<option value="' + i + '">' + escapeHtml(label) + '</option>';
		}
		html += '</select>';
		html += '<button class="webrtc-btn webrtc-btn-primary" onclick="WebRTCPhone.selectExtension()">' + t('connect') + '</button>';
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
		html += state.registered ? t('registered') : t('connecting');
		html += '</span>';
		html += '<button class="webrtc-settings-btn' + (state.showSettings ? ' webrtc-settings-btn-active' : '') + '" onclick="WebRTCPhone.openSettings()" title="' + t('audioSettings') + '">';
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
				html += renderTabs();
				html += state.showNetworkTest ? renderNetworkTestPanel() : (state.showHistory ? renderHistoryPanel() : renderDialPad());
			} else if (state.callState === 'ringing_in') {
				html += '<div class="webrtc-call-info">';
				html += '<div class="webrtc-call-icon webrtc-call-icon-incoming">&#9742;</div>';
				html += '<div class="webrtc-call-label">' + t('incomingCall') + '</div>';
				html += '<div class="webrtc-call-number">' + getRemoteIdentity() + '</div>';
				html += '<div class="webrtc-call-actions">';
				html += '<button class="webrtc-btn webrtc-btn-answer" onclick="WebRTCPhone.answer()">' + t('answer') + '</button>';
				html += '<button class="webrtc-btn webrtc-btn-reject" onclick="WebRTCPhone.reject()">' + t('reject') + '</button>';
				html += '</div></div>';
			} else if (state.callState === 'ringing_out') {
				html += '<div class="webrtc-call-info">';
				html += '<div class="webrtc-call-icon">&#9742;</div>';
				html += '<div class="webrtc-call-label">' + t('outgoingCall') + '</div>';
				html += '<div class="webrtc-call-number">' + escapeHtml(state.dialInput) + '</div>';
				html += '<div class="webrtc-call-actions">';
				html += '<button class="webrtc-btn webrtc-btn-hangup" onclick="WebRTCPhone.hangup()">' + t('hangUp') + '</button>';
				html += '</div></div>';
			} else if (state.callState === 'in_call') {
				html += '<div class="webrtc-call-info">';
				html += '<div class="webrtc-call-icon webrtc-call-icon-active">&#9742;</div>';
				html += '<div class="webrtc-call-label">' + t('inCall') + '</div>';
				html += '<div class="webrtc-call-number">' + getRemoteIdentity() + '</div>';
				html += '<div id="webrtc-call-timer" class="webrtc-call-timer">' + formatDuration(state.callDuration) + '</div>';
				// Quality indicator
				html += '<div id="webrtc-quality-indicator" class="webrtc-quality-indicator webrtc-quality-unknown">';
				html += '<span class="webrtc-quality-dots">&#9675;&#9675;&#9675;&#9675;</span> <span class="webrtc-quality-label">' + t('measuring') + '</span>';
				html += '</div>';
				html += '<div id="webrtc-quality-details" class="webrtc-quality-details"></div>';
				html += '<div id="webrtc-quality-issues" class="webrtc-quality-issues"></div>';
				// Audio level indicators
				html += '<div class="webrtc-audio-levels">';
				html += '<div class="webrtc-audio-level webrtc-audio-level-mic">';
				html += '<span class="webrtc-audio-level-label">MIC</span>';
				html += '<div class="webrtc-audio-level-bar-bg"><div id="webrtc-mic-level-bar" class="webrtc-audio-level-bar" style="width:0%"></div></div>';
				html += '</div>';
				html += '<div class="webrtc-audio-level webrtc-audio-level-spk">';
				html += '<span class="webrtc-audio-level-label">SPK</span>';
				html += '<div class="webrtc-audio-level-bar-bg"><div id="webrtc-spk-level-bar" class="webrtc-audio-level-bar" style="width:0%"></div></div>';
				html += '</div></div>';
				html += '<div class="webrtc-call-actions">';
				html += '<button class="webrtc-btn webrtc-btn-sm ' + (state.muted ? 'webrtc-btn-active' : '') + '" onclick="WebRTCPhone.toggleMute()">' + (state.muted ? t('unmute') : t('mute')) + '</button>';
				html += '<button class="webrtc-btn webrtc-btn-sm ' + (state.held ? 'webrtc-btn-active' : '') + '" onclick="WebRTCPhone.toggleHold()">' + (state.held ? t('resume') : t('hold')) + '</button>';
				html += '<button class="webrtc-btn webrtc-btn-hangup" onclick="WebRTCPhone.hangup()">' + t('hangUp') + '</button>';
				html += '</div>';
				html += renderInCallDTMF();
				html += '<div class="webrtc-transfer">';
				html += '<input type="text" id="webrtc-transfer-input" class="webrtc-input webrtc-input-sm" placeholder="' + t('transferTo') + '">';
				html += '<button class="webrtc-btn webrtc-btn-sm webrtc-btn-primary" onclick="WebRTCPhone.transfer()">' + t('transfer') + '</button>';
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
		html += '<div class="webrtc-settings-title">&#127925; ' + t('ringtone') + '</div>';
		html += '<div class="webrtc-settings-row">';
		html += '<select class="webrtc-select webrtc-select-sm" style="flex:1" onchange="WebRTCPhone.setRingtone(this.value)">';
		for (var i = 0; i < ringtones.length; i++) {
			html += '<option value="' + i + '"' + (i === as.ringtoneIndex ? ' selected' : '') + '>' + escapeHtml(ringtones[i].name) + '</option>';
		}
		html += '</select>';
		html += '<button id="webrtc-preview-btn" class="webrtc-btn webrtc-btn-sm webrtc-btn-secondary" onclick="WebRTCPhone.previewRingtone()">' + (state.previewingRingtone ? t('stop') : t('preview')) + '</button>';
		html += '</div>';
		html += '<div class="webrtc-volume-row">';
		html += '<span class="webrtc-volume-label">' + t('ringVolume') + '</span>';
		html += '<input type="range" class="webrtc-volume-slider" min="0" max="1" step="0.05" value="' + as.ringVolume + '" oninput="document.getElementById(\'webrtc-ring-vol-pct\').textContent=Math.round(this.value*100)+\'%\';WebRTCPhone.setRingVolume(this.value)">';
		html += '<span id="webrtc-ring-vol-pct" class="webrtc-volume-pct">' + ringVolPct + '%</span>';
		html += '</div></div>';

		html += '<div class="webrtc-settings-section">';
		html += '<div class="webrtc-settings-title">&#128276; ' + t('ringDevice') + '</div>';
		if (sinkIdSupported) {
			html += '<select class="webrtc-select webrtc-select-sm" onchange="WebRTCPhone.setRingDevice(this.value)">';
			html += '<option value="default"' + (as.ringDeviceId === 'default' ? ' selected' : '') + '>' + t('defaultDevice') + '</option>';
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
		html += '<div class="webrtc-settings-title">&#128266; ' + t('speakerDevice') + '</div>';
		if (sinkIdSupported) {
			html += '<select class="webrtc-select webrtc-select-sm" onchange="WebRTCPhone.setSpeakerDevice(this.value)">';
			html += '<option value="default"' + (as.speakerDeviceId === 'default' ? ' selected' : '') + '>' + t('defaultDevice') + '</option>';
			for (var k = 0; k < devices.outputs.length; k++) {
				var dk = devices.outputs[k];
				html += '<option value="' + escapeHtml(dk.id) + '"' + (dk.id === as.speakerDeviceId ? ' selected' : '') + '>' + escapeHtml(dk.label) + '</option>';
			}
			html += '</select>';
		}
		html += '<div class="webrtc-volume-row">';
		html += '<span class="webrtc-volume-label">' + t('speakerVolume') + '</span>';
		html += '<input type="range" class="webrtc-volume-slider" min="0" max="1" step="0.05" value="' + as.speakerVolume + '" oninput="document.getElementById(\'webrtc-spk-vol-pct\').textContent=Math.round(this.value*100)+\'%\';WebRTCPhone.setSpeakerVolume(this.value)">';
		html += '<span id="webrtc-spk-vol-pct" class="webrtc-volume-pct">' + spkVolPct + '%</span>';
		html += '</div>';
		html += '<label class="webrtc-agc-toggle"><input type="checkbox"' + (as.spkAGC ? ' checked' : '') + ' onchange="WebRTCPhone.toggleSpkAGC(this.checked)"><span>' + t('spkAGC') + '</span></label>';
		html += '</div>';

		html += '<div class="webrtc-settings-section">';
		html += '<div class="webrtc-settings-title">&#127908; ' + t('microphone') + '</div>';
		html += '<select class="webrtc-select webrtc-select-sm" onchange="WebRTCPhone.setMicDevice(this.value)">';
		html += '<option value="default"' + (as.micDeviceId === 'default' ? ' selected' : '') + '>' + t('defaultDevice') + '</option>';
		for (var m = 0; m < devices.inputs.length; m++) {
			var dm = devices.inputs[m];
			html += '<option value="' + escapeHtml(dm.id) + '"' + (dm.id === as.micDeviceId ? ' selected' : '') + '>' + escapeHtml(dm.label) + '</option>';
		}
		html += '</select>';
		if (devices.inputs.length === 0) html += '<div class="webrtc-settings-note">Grant microphone access to list devices.</div>';
		var micVolPct = Math.round(as.micVolume * 100);
		html += '<div class="webrtc-volume-row">';
		html += '<span class="webrtc-volume-label">' + t('micVolume') + '</span>';
		html += '<input type="range" class="webrtc-volume-slider" min="0" max="1" step="0.05" value="' + as.micVolume + '" oninput="document.getElementById(\'webrtc-mic-vol-pct\').textContent=Math.round(this.value*100)+\'%\';WebRTCPhone.setMicVolume(this.value)">';
		html += '<span id="webrtc-mic-vol-pct" class="webrtc-volume-pct">' + micVolPct + '%</span>';
		html += '</div>';
		html += '<label class="webrtc-agc-toggle"><input type="checkbox"' + (as.micAGC ? ' checked' : '') + ' onchange="WebRTCPhone.toggleMicAGC(this.checked)"><span>' + t('micAGC') + '</span></label>';
		html += '</div>';

		html += '<button class="webrtc-btn webrtc-btn-primary webrtc-settings-done" onclick="WebRTCPhone.closeSettings()">Done</button>';
		html += '</div>';
		return html;
	}

	function renderTabs() {
		var activeTab = state.showNetworkTest ? 'network' : (state.showHistory ? 'history' : 'keypad');
		var html = '<div class="webrtc-tabs">';
		html += '<button class="webrtc-tab' + (activeTab === 'keypad' ? ' webrtc-tab-active' : '') + '" onclick="WebRTCPhone.closeHistory();WebRTCPhone.closeNetworkTest()">' + t('dialpad') + '</button>';
		html += '<button class="webrtc-tab' + (activeTab === 'history' ? ' webrtc-tab-active' : '') + '" onclick="WebRTCPhone.closeNetworkTest();WebRTCPhone.openHistory()">' + t('history') + '</button>';
		html += '<button class="webrtc-tab' + (activeTab === 'network' ? ' webrtc-tab-active' : '') + '" onclick="WebRTCPhone.closeHistory();WebRTCPhone.openNetworkTest()">' + t('network') + '</button>';
		html += '</div>';
		return html;
	}

	function renderHistoryPanel() {
		var html = '<div class="webrtc-history">';
		if (state.callHistory.length === 0) {
			html += '<div class="webrtc-history-empty">' + t('noRecentCalls') + '</div>';
		} else {
			html += '<div class="webrtc-history-list">';
			for (var i = 0; i < state.callHistory.length; i++) {
				var rec = state.callHistory[i];
				var num = rec.number || 'Unknown';
				var name = rec.name || '';
				var arrow = rec.direction === 'inbound' ? '&#x2199;' : '&#x2197;';
				var iconClass = 'webrtc-history-icon-' + rec.direction + '-' + rec.status;
				var timeStr = formatTimeAgo(rec.timestamp);
				var durStr = (rec.status === 'answered' && rec.duration > 0) ? ' &middot; ' + escapeHtml(formatDuration(rec.duration)) : '';
				html += '<div class="webrtc-history-item" onclick="WebRTCPhone.dialFromHistory(' + i + ')">';
				html += '<div class="webrtc-history-icon ' + iconClass + '">' + arrow + '</div>';
				html += '<div class="webrtc-history-details">';
				if (name) {
					html += '<div class="webrtc-history-name">' + escapeHtml(name) + '</div>';
					html += '<div class="webrtc-history-number">' + escapeHtml(num) + '</div>';
				} else {
					html += '<div class="webrtc-history-name">' + escapeHtml(num) + '</div>';
				}
				html += '<div class="webrtc-history-meta">' + escapeHtml(timeStr) + durStr + '</div>';
				// Quality info
				if (rec.quality) {
					html += '<div class="webrtc-history-quality">';
					html += '<span class="webrtc-history-quality-badge webrtc-quality-' + rec.quality.rating + '">';
					html += rec.quality.rating.charAt(0).toUpperCase() + rec.quality.rating.slice(1);
					html += ' (MOS ' + rec.quality.mos.toFixed(1) + ')</span>';
					if (rec.quality.issues && rec.quality.issues.length > 0) {
						html += '<span class="webrtc-history-quality-issues">' + escapeHtml(rec.quality.issues.join(', ')) + '</span>';
					}
					html += '</div>';
				}
				html += '</div>';
				html += '<button class="webrtc-history-call-btn" onclick="event.stopPropagation();WebRTCPhone.dialFromHistory(' + i + ')" title="Dial">';
				html += '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/></svg>';
				html += '</button>';
				html += '</div>';
			}
			html += '</div>';
			html += '<button class="webrtc-btn webrtc-btn-sm webrtc-history-clear" onclick="WebRTCPhone.clearHistory()">' + t('clearHistory') + '</button>';
		}
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

	// --- Report Generation ---

	function buildReportText() {
		var r = state.networkTestResults;
		if (!r) return '';
		var ext = state.selectedExtension || {};
		var lines = [];
		lines.push('=== WebRTC Phone Network Quality Report ===');
		lines.push('Date: ' + new Date().toLocaleString());
		lines.push('Domain: ' + (state.config ? state.config.domain : 'N/A'));
		lines.push('Extension: ' + (ext.extension || 'N/A') + (ext.caller_id_name ? ' (' + ext.caller_id_name + ')' : ''));
		lines.push('');

		// WSS
		if (r.wss !== null) {
			lines.push('[' + (r.wss.ok ? 'PASS' : 'FAIL') + '] WSS Server: ' + (r.wss.ok ? r.wss.time + 'ms' : r.wss.error));
		}
		// STUN
		if (r.stun !== null) {
			lines.push('[' + (r.stun.ok ? 'PASS' : 'FAIL') + '] STUN Server: ' + (r.stun.ok ? r.stun.time + 'ms' + (r.stun.ip ? ' (' + r.stun.ip + ')' : '') : r.stun.error));
		}
		// Latency
		if (r.latency !== null) {
			var latOk = r.latency.rtt > 0 && r.latency.rtt < 300;
			lines.push('[' + (r.latency.rtt > 0 ? (latOk ? 'PASS' : 'WARN') : 'FAIL') + '] Latency: ' + (r.latency.rtt > 0 ? r.latency.rtt + 'ms' : (r.latency.error || 'N/A')));
		}
		// Jitter
		if (r.jitterTest !== null) {
			lines.push('[' + (r.jitterTest.ok ? 'PASS' : 'WARN') + '] System Jitter: ' + r.jitterTest.jitter + 'ms');
		}
		// SIP Ping
		if (r.sipPing !== null) {
			lines.push('[' + (r.sipPing.ok ? 'PASS' : 'FAIL') + '] SIP Signaling: ' + (r.sipPing.ok ? r.sipPing.time + 'ms' : (r.sipPing.error || 'Failed')));
		}
		lines.push('');

		// Echo Test / Demo Call
		if (r.demoCall !== null && r.demoCall.status !== 'calling' && r.demoCall.status !== 'connected') {
			if (r.demoCall.error) {
				lines.push('[FAIL] Echo Test: ' + r.demoCall.error);
			} else {
				lines.push('[' + (r.demoCall.ok ? 'PASS' : 'FAIL') + '] Echo Test: ' + (r.demoCall.ok ? r.demoCall.rating + ' (MOS ' + r.demoCall.mos.toFixed(1) + ')' : 'Failed'));
				if (r.demoCall.ok || r.demoCall.packetsReceived > 0) {
					lines.push('  Recv: ' + r.demoCall.packetsReceived + ' pkts | Sent: ' + (r.demoCall.packetsSent || 0) + ' pkts | Loss: ' + r.demoCall.packetLoss + '% | Jitter: ' + r.demoCall.jitter + 'ms | RTT: ' + r.demoCall.rtt + 'ms');
				}
				// Bandwidth
				lines.push('');
				lines.push('--- Bandwidth (UDP via RTP) ---');
				if (r.demoCall.bitrate > 0) lines.push('  Download: ' + r.demoCall.bitrate + ' kbps');
				if (r.demoCall.bitrateOut > 0) lines.push('  Upload: ' + r.demoCall.bitrateOut + ' kbps');
				if (r.demoCall.availableBandwidth > 0) lines.push('  Available: ' + r.demoCall.availableBandwidth + ' kbps');
				// Audio Test
				if (r.demoCall.audioTest) {
					var at = r.demoCall.audioTest;
					lines.push('');
					lines.push('--- Audio & Microphone Test ---');
					lines.push('  Microphone: ' + at.mic.rating + ' (avg ' + at.mic.avg + '%, peak ' + at.mic.max + '%)');
					lines.push('  Echo Return: ' + at.spk.rating + ' (avg ' + at.spk.avg + '%, peak ' + at.spk.max + '%)');
					lines.push('  Full Duplex: ' + (at.echoDetected ? 'Two-way audio confirmed' : 'Audio path incomplete'));
					if (at.issues && at.issues.length > 0) {
						lines.push('  Issues: ' + at.issues.join(', '));
					}
				}
				// Demo call issues
				if (r.demoCall.issues && r.demoCall.issues.length > 0) {
					lines.push('  Issues: ' + r.demoCall.issues.join(', '));
				}
			}
		}
		lines.push('');

		// Reference Pings
		if (r.refPings && r.refPings.length > 0) {
			lines.push('--- Internet Baseline ---');
			for (var i = 0; i < r.refPings.length; i++) {
				var rp = r.refPings[i];
				lines.push('  ' + rp.name + ': ' + (rp.ok ? rp.time + 'ms' : (rp.error || 'Failed')));
			}
			lines.push('');
		}

		// Path Trace
		if (r.pathTrace) {
			lines.push('--- Path Trace ---');
			if (r.pathTrace.error) {
				lines.push('  Error: ' + r.pathTrace.error);
			} else {
				var pt = r.pathTrace;
				lines.push('  Stability: ' + pt.stability + '% (' + (pt.stability >= 80 ? 'Stable' : 'Unstable') + ')');
				lines.push('  Avg: ' + pt.avg + 'ms | Min: ' + pt.min + 'ms | Max: ' + pt.max + 'ms | Jitter: ' + pt.jitter + 'ms');
				if (pt.spikes > 0) lines.push('  Spikes: ' + pt.spikes);
				if (pt.failedPings > 0) lines.push('  Failed: ' + pt.failedPings + '/' + pt.totalPings);
				lines.push('  NAT Type: ' + pt.natType);
				if (pt.iceInfo.localIP) lines.push('  Local IP: ' + pt.iceInfo.localIP);
				if (pt.iceInfo.publicIP) lines.push('  Public IP: ' + pt.iceInfo.publicIP);
				// Ping samples
				lines.push('  Ping samples: ' + pt.samples.map(function(s) { return s.time > 0 ? s.time + 'ms' : 'fail'; }).join(', '));
				if (pt.issues && pt.issues.length > 0) {
					lines.push('  Issues: ' + pt.issues.join(', '));
				}
			}
			lines.push('');
		}

		// Diagnosis
		if (r.diagnosis) {
			var d = r.diagnosis;
			var sourceMap = { user: 'Your Network', server: 'VoIP Server', none: 'No Issues', unknown: 'Undetermined' };
			lines.push('=== DIAGNOSIS ===');
			lines.push('Issue Source: ' + (sourceMap[d.source] || 'Undetermined'));
			if (d.issues.length > 0) {
				lines.push('Findings:');
				for (var fi = 0; fi < d.issues.length; fi++) {
					lines.push('  - ' + d.issues[fi]);
				}
			}
			if (d.suggestions.length > 0) {
				lines.push('Suggested Fixes:');
				for (var si = 0; si < d.suggestions.length; si++) {
					lines.push('  - ' + d.suggestions[si]);
				}
			}
		}

		lines.push('');
		lines.push('--- Generated by FusionPBX WebRTC Phone ---');
		return lines.join('\n');
	}

	function buildReportHTML() {
		var r = state.networkTestResults;
		if (!r) return '';
		var ext = state.selectedExtension || {};
		var h = [];

		h.push('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Network Quality Report</title>');
		h.push('<style>');
		h.push('*{box-sizing:border-box;margin:0;padding:0;}');
		h.push('body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;width:100%;margin:0 auto;padding:12px 20px;color:#333;font-size:12px;line-height:1.3;}');
		h.push('h1{font-size:16px;border-bottom:2px solid #1976d2;padding-bottom:4px;color:#1976d2;margin-bottom:6px;}');
		h.push('h2{font-size:11px;margin:8px 0 3px;color:#555;border-bottom:1px solid #ddd;padding-bottom:2px;text-transform:uppercase;letter-spacing:0.5px;}');
		h.push('.header-row{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;}');
		h.push('.info{color:#666;font-size:11px;}');
		h.push('.cols{display:table !important;width:100%;table-layout:fixed;border-spacing:12px 0;}');
		h.push('.col{display:table-cell !important;width:50%;vertical-align:top;overflow:hidden;}');
		h.push('.test-row{display:flex;align-items:center;padding:2px 0;border-bottom:1px solid #f5f5f5;}');
		h.push('.icon{width:16px;text-align:center;font-size:12px;margin-right:4px;flex-shrink:0;}');
		h.push('.pass .icon{color:#4caf50;} .fail .icon{color:#f44336;} .warn .icon{color:#ff9800;}');
		h.push('.label{flex:1;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;} .value{color:#666;text-align:right;white-space:nowrap;margin-left:6px;font-size:11px;}');
		h.push('.details{padding:1px 0 1px 20px;color:#888;font-size:10px;}');
		h.push('.issues{padding:2px 0 2px 20px;} .issues span{display:inline-block;background:#fff3e0;color:#e65100;padding:1px 4px;border-radius:3px;font-size:10px;margin:1px;}');
		h.push('.diagnosis{background:#f5f5f5;border-radius:6px;padding:8px;margin-top:6px;}');
		h.push('.diag-source{font-size:13px;font-weight:600;margin-bottom:3px;}');
		h.push('.diag-pass .diag-source{color:#4caf50;} .diag-warn .diag-source{color:#ff9800;} .diag-fail .diag-source{color:#f44336;}');
		h.push('.diag-list{margin:3px 0;} .diag-item{padding:1px 0;font-size:11px;}');
		h.push('.bar-chart{display:flex;align-items:flex-end;gap:2px;height:28px;margin:3px 0;}');
		h.push('.bar{flex:1;border-radius:2px 2px 0 0;min-width:3px;} .bar-ok{background:#4caf50;} .bar-spike{background:#ff9800;} .bar-fail{background:#f44336;opacity:0.4;}');
		h.push('.hop-table{width:100%;border-collapse:collapse;margin:3px 0;font-size:10px;}');
		h.push('.hop-table th{background:#f5f5f5;padding:1px 4px;text-align:left;font-weight:600;border-bottom:1px solid #ddd;}');
		h.push('.hop-table td{padding:1px 4px;border-bottom:1px solid #f0f0f0;}');
		h.push('.hop-ok{color:#4caf50;} .hop-spike{color:#ff9800;} .hop-fail{color:#f44336;}');
		h.push('.footer{margin-top:8px;padding-top:6px;border-top:1px solid #ddd;color:#999;font-size:10px;text-align:center;}');
		h.push('@media print{body{margin:0;padding:6px;width:100%;} @page{size:landscape;margin:8mm;} .cols{display:table !important;width:100% !important;} .col{display:table-cell !important;overflow:visible !important;} .hop-table{page-break-inside:avoid;} h2{page-break-after:avoid;}}');
		h.push('</style></head><body>');

		// Header with info
		h.push('<div class="header-row"><div>');
		h.push('<h1>WebRTC Phone Network Quality Report</h1>');
		h.push('</div><div class="info" style="text-align:right;">');
		h.push(new Date().toLocaleString() + '<br>');
		h.push('<strong>' + escapeHtml(state.config ? state.config.domain : 'N/A') + '</strong> | Ext: ' + escapeHtml(ext.extension || 'N/A') + (ext.caller_id_name ? ' (' + escapeHtml(ext.caller_id_name) + ')' : ''));
		h.push('</div></div>');

		function row(cls, icon, label, value) {
			return '<div class="test-row ' + cls + '"><span class="icon">' + icon + '</span><span class="label">' + label + '</span><span class="value">' + value + '</span></div>';
		}

		// Two-column layout
		h.push('<div class="cols"><div class="col">');

		// Left column: Connectivity + Echo + Bandwidth + Audio
		h.push('<h2>Connectivity</h2>');
		if (r.wss !== null) h.push(row(r.wss.ok ? 'pass' : 'fail', r.wss.ok ? '&#10003;' : '&#10007;', 'WSS Server', r.wss.ok ? r.wss.time + 'ms' : escapeHtml(r.wss.error)));
		if (r.stun !== null) h.push(row(r.stun.ok ? 'pass' : 'fail', r.stun.ok ? '&#10003;' : '&#10007;', 'STUN Server', r.stun.ok ? r.stun.time + 'ms' + (r.stun.ip ? ' (' + escapeHtml(r.stun.ip) + ')' : '') : escapeHtml(r.stun.error)));
		if (r.latency !== null) {
			var latOk = r.latency.rtt > 0 && r.latency.rtt < 300;
			h.push(row(r.latency.rtt > 0 ? (latOk ? 'pass' : 'warn') : 'fail', r.latency.rtt > 0 ? (latOk ? '&#10003;' : '&#9888;') : '&#10007;', 'Latency', r.latency.rtt > 0 ? r.latency.rtt + 'ms' : (r.latency.error || 'N/A')));
		}
		if (r.jitterTest !== null) h.push(row(r.jitterTest.ok ? 'pass' : 'warn', r.jitterTest.ok ? '&#10003;' : '&#9888;', 'System Jitter', r.jitterTest.jitter + 'ms'));
		if (r.sipPing !== null) h.push(row(r.sipPing.ok ? 'pass' : 'fail', r.sipPing.ok ? '&#10003;' : '&#10007;', 'SIP Signaling', r.sipPing.ok ? r.sipPing.time + 'ms' : (r.sipPing.error || 'Failed')));

		// Echo Test
		if (r.demoCall !== null && !r.demoCall.status) {
			h.push('<h2>Echo Test</h2>');
			if (r.demoCall.error) {
				h.push(row('fail', '&#10007;', 'Echo Test', escapeHtml(r.demoCall.error)));
			} else {
				h.push(row(r.demoCall.ok ? 'pass' : 'fail', r.demoCall.ok ? '&#10003;' : '&#10007;', 'Result', r.demoCall.ok ? r.demoCall.rating + ' (MOS ' + r.demoCall.mos.toFixed(1) + ')' : 'Failed'));
				if (r.demoCall.ok || r.demoCall.packetsReceived > 0) {
					h.push('<div class="details">Recv:' + r.demoCall.packetsReceived + ' Sent:' + (r.demoCall.packetsSent || 0) + ' Loss:' + r.demoCall.packetLoss + '% Jitter:' + r.demoCall.jitter + 'ms RTT:' + r.demoCall.rtt + 'ms</div>');
				}
				// Bandwidth
				h.push('<h2>Bandwidth (UDP/RTP)</h2>');
				if (r.demoCall.bitrate > 0) h.push(row(r.demoCall.bitrate >= 40 ? 'pass' : (r.demoCall.bitrate >= 20 ? 'warn' : 'fail'), r.demoCall.bitrate >= 40 ? '&#10003;' : '&#9888;', 'Download', r.demoCall.bitrate + ' kbps'));
				if (r.demoCall.bitrateOut > 0) h.push(row(r.demoCall.bitrateOut >= 40 ? 'pass' : (r.demoCall.bitrateOut >= 20 ? 'warn' : 'fail'), r.demoCall.bitrateOut >= 40 ? '&#10003;' : '&#9888;', 'Upload', r.demoCall.bitrateOut + ' kbps'));
				if (r.demoCall.availableBandwidth > 0) h.push(row(r.demoCall.availableBandwidth >= 100 ? 'pass' : 'warn', r.demoCall.availableBandwidth >= 100 ? '&#10003;' : '&#9888;', 'Available', r.demoCall.availableBandwidth + ' kbps'));
				// Audio
				if (r.demoCall.audioTest) {
					var at = r.demoCall.audioTest;
					h.push('<h2>Audio / Mic</h2>');
					h.push(row(at.mic.ok ? 'pass' : 'fail', at.mic.ok ? '&#10003;' : '&#10007;', 'Microphone', at.mic.rating + ' (' + at.mic.avg + '%/' + at.mic.max + '%)'));
					h.push(row(at.spk.ok ? 'pass' : 'fail', at.spk.ok ? '&#10003;' : '&#10007;', 'Echo Return', at.spk.rating + ' (' + at.spk.avg + '%/' + at.spk.max + '%)'));
					h.push(row(at.echoDetected ? 'pass' : 'fail', at.echoDetected ? '&#10003;' : '&#10007;', 'Full Duplex', at.echoDetected ? 'OK' : 'Incomplete'));
				}
				if (r.demoCall.issues && r.demoCall.issues.length > 0) {
					h.push('<div class="issues">');
					for (var di = 0; di < r.demoCall.issues.length; di++) h.push('<span>' + escapeHtml(r.demoCall.issues[di]) + '</span>');
					h.push('</div>');
				}
			}
		}

		// Reference Pings
		if (r.refPings && r.refPings.length > 0) {
			h.push('<h2>Internet Baseline</h2>');
			for (var rpi = 0; rpi < r.refPings.length; rpi++) {
				var rp = r.refPings[rpi];
				var rpOk = rp.ok && rp.time < 200;
				h.push(row(rp.ok ? (rpOk ? 'pass' : 'warn') : 'fail', rp.ok ? (rpOk ? '&#10003;' : '&#9888;') : '&#10007;', escapeHtml(rp.name), rp.ok ? rp.time + 'ms' : (rp.error || 'Failed')));
			}
		}

		// End left column, start right column
		h.push('</div><div class="col">');

		// Right column: Path Trace + Diagnosis
		if (r.pathTrace) {
			h.push('<h2>Path Trace</h2>');
			if (r.pathTrace.error) {
				h.push(row('fail', '&#10007;', 'Server Route', escapeHtml(r.pathTrace.error)));
			}
			if (!r.pathTrace.error || (r.pathTrace.samples && r.pathTrace.samples.length > 0)) {
				var pt = r.pathTrace;
				if (!r.pathTrace.error) {
					h.push(row(pt.stability >= 80 ? 'pass' : (pt.stability >= 50 ? 'warn' : 'fail'), pt.stability >= 80 ? '&#10003;' : '&#9888;', 'Stability', pt.stability + '% (' + (pt.stability >= 80 ? 'Stable' : 'Unstable') + ')'));
					h.push('<div class="details">Avg:' + pt.avg + 'ms Min:' + pt.min + 'ms Max:' + pt.max + 'ms Jitter:' + pt.jitter + 'ms</div>');
					// Bar chart
					h.push('<div class="bar-chart">');
					for (var pi = 0; pi < pt.samples.length; pi++) {
						var ps = pt.samples[pi];
						var barH = ps.time > 0 ? Math.min(100, Math.max(5, Math.round((ps.time / (pt.max || 1)) * 100))) : 0;
						var barCls = ps.time < 0 ? 'bar-fail' : (ps.time > pt.avg * 2 ? 'bar-spike' : 'bar-ok');
						h.push('<div class="bar ' + barCls + '" style="height:' + barH + '%"></div>');
					}
					h.push('</div>');
				}
				// Traceroute nodes table (shown even on partial failure)
				if (pt.samples && pt.samples.length > 0) {
					var ptDomain = state.config ? state.config.domain : 'N/A';
					var ptPublicIP = pt.iceInfo && pt.iceInfo.publicIP ? pt.iceInfo.publicIP : '';
					var ptLocalIP = pt.iceInfo && pt.iceInfo.localIP ? pt.iceInfo.localIP : '';
					var ptAvg = pt.avg || 0;
					h.push('<table class="hop-table">');
					h.push('<tr><th>Hop</th><th>Server</th><th>IP</th><th>Latency</th><th>Status</th></tr>');
					for (var hi = 0; hi < pt.samples.length; hi++) {
						var hs = pt.samples[hi];
						var hCls = hs.time < 0 ? 'hop-fail' : (ptAvg > 0 && hs.time > ptAvg * 2 ? 'hop-spike' : 'hop-ok');
						var hStatus = hs.time < 0 ? 'Failed' : (ptAvg > 0 && hs.time > ptAvg * 2 ? 'Spike' : 'OK');
						h.push('<tr class="' + hCls + '">');
						h.push('<td>' + hs.hop + '</td>');
						h.push('<td>' + escapeHtml(ptDomain) + '</td>');
						h.push('<td>' + (ptPublicIP || ptLocalIP || 'N/A') + '</td>');
						h.push('<td>' + (hs.time > 0 ? hs.time + 'ms' : '---') + '</td>');
						h.push('<td>' + hStatus + '</td>');
						h.push('</tr>');
					}
					h.push('</table>');
				}
			}
			if (!r.pathTrace.error) {
				var pt = r.pathTrace;
				h.push(row('pass', '&#128270;', 'NAT Type', escapeHtml(pt.natType)));
				if (pt.iceInfo.localIP || pt.iceInfo.publicIP) {
					var ips2 = [];
					if (pt.iceInfo.localIP) ips2.push('Local: ' + pt.iceInfo.localIP);
					if (pt.iceInfo.publicIP) ips2.push('Public: ' + pt.iceInfo.publicIP);
					h.push('<div class="details">' + ips2.join(' | ') + '</div>');
				}
				// ICE candidates detail
				if (pt.iceInfo.candidates && pt.iceInfo.candidates.length > 0) {
					h.push('<h2>ICE Candidates</h2>');
					h.push('<table class="hop-table">');
					h.push('<tr><th>Type</th><th>Protocol</th><th>Address</th><th>Port</th></tr>');
					for (var ci = 0; ci < pt.iceInfo.candidates.length; ci++) {
						var cand = pt.iceInfo.candidates[ci];
						h.push('<tr><td>' + escapeHtml(cand.type) + '</td><td>' + escapeHtml(cand.protocol) + '</td><td>' + escapeHtml(cand.address || 'N/A') + '</td><td>' + (cand.port || '') + '</td></tr>');
					}
					h.push('</table>');
				}
				if (pt.issues && pt.issues.length > 0) {
					h.push('<div class="issues">');
					for (var pti = 0; pti < pt.issues.length; pti++) h.push('<span>' + escapeHtml(pt.issues[pti]) + '</span>');
					h.push('</div>');
				}
			}
		}

		// Diagnosis
		if (r.diagnosis) {
			var d = r.diagnosis;
			var sourceMap = { user: 'Your Network', server: 'VoIP Server', none: 'No Issues', unknown: 'Undetermined' };
			var diagCls = d.source === 'none' ? 'diag-pass' : (d.source === 'server' ? 'diag-fail' : 'diag-warn');
			h.push('<div class="diagnosis ' + diagCls + '">');
			h.push('<div class="diag-source">Issue Source: ' + (sourceMap[d.source] || 'Undetermined') + '</div>');
			if (d.issues.length > 0 && d.source !== 'none') {
				h.push('<div class="diag-list"><strong>Findings:</strong>');
				for (var fi = 0; fi < d.issues.length; fi++) h.push('<div class="diag-item">' + escapeHtml(d.issues[fi]) + '</div>');
				h.push('</div>');
			}
			if (d.suggestions.length > 0) {
				h.push('<div class="diag-list"><strong>' + (d.source === 'none' ? '' : 'Suggested Fixes:') + '</strong>');
				for (var sj = 0; sj < d.suggestions.length; sj++) h.push('<div class="diag-item">' + escapeHtml(d.suggestions[sj]) + '</div>');
				h.push('</div>');
			}
			h.push('</div>');
		}

		// End right column
		h.push('</div></div>');

		h.push('<div class="footer">Generated by FusionPBX WebRTC Phone</div>');
		h.push('</body></html>');
		return h.join('\n');
	}

	function downloadReportPDF() {
		var html = buildReportHTML();
		if (!html) return;
		var win = window.open('', '_blank');
		if (!win) {
			alert(t('popupBlocked'));
			return;
		}
		win.document.write(html);
		win.document.close();
		setTimeout(function () { win.print(); }, 400);
	}

	function sendReportEmail() {
		var reportText = buildReportText();
		var reportHtml = buildReportHTML();
		if (!reportText) return;
		var ext = state.selectedExtension || {};
		var btn = document.getElementById('webrtc-send-report-btn');
		if (btn) { btn.disabled = true; btn.textContent = t('sending'); }

		fetch('/app/web_phone2/webrtc_phone_report.php', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify({
				report: reportText,
				report_html: reportHtml,
				extension: ext.extension || ''
			})
		}).then(function (resp) {
			if (!resp.ok) throw new Error('HTTP ' + resp.status);
			return resp.json();
		}).then(function (data) {
			if (data.success) {
				alert(t('reportSent'));
			} else {
				var msg = data.message || 'Unknown error';
				if (data.smtp_host) msg += '\nSMTP: ' + data.smtp_host;
				alert(t('reportFailed') + ':\n' + msg);
			}
		}).catch(function (err) {
			alert(t('reportFailed') + ': ' + err.message);
		}).finally(function () {
			if (btn) { btn.disabled = false; btn.textContent = t('sendReport'); }
		});
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
		setRingDevice: setRingDevice, setSpeakerDevice: setSpeakerDevice, setMicDevice: setMicDevice, setMicVolume: setMicVolume, toggleMicAGC: toggleMicAGC, toggleSpkAGC: toggleSpkAGC,
		previewRingtone: previewRingtone,
		openHistory: openHistory, closeHistory: closeHistory,
		clearHistory: clearHistory, dialFromHistory: dialFromHistory,
		openNetworkTest: openNetworkTest, closeNetworkTest: closeNetworkTest, runNetworkTest: runNetworkTest,
		downloadReportPDF: downloadReportPDF, sendReportEmail: sendReportEmail
	};

})();
