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
			'<span class="webrtc-quality-label">' + q.rating.charAt(0).toUpperCase() + q.rating.slice(1) + '</span>';

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
		state.networkTestResults = { wss: null, stun: null, latency: null, jitterTest: null };
		renderPhone();

		var results = state.networkTestResults;
		var testsRemaining = 3;
		function checkDone() {
			testsRemaining--;
			if (testsRemaining <= 0) {
				state.networkTestRunning = false;
				renderPhone();
			} else {
				renderPhone();
			}
		}

		// Test 1: WSS connectivity
		(function testWSS() {
			var start = Date.now();
			var ws = null;
			var timeout = setTimeout(function () {
				results.wss = { ok: false, time: 0, error: 'Timeout (5s)' };
				try { ws.close(); } catch (e) {}
				checkDone();
			}, 5000);
			try {
				ws = new WebSocket('wss://' + state.config.domain + ':' + state.config.wss_port);
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

		// Test 3: Jitter estimation via timing consistency
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
	}

	// --- Audio Level Monitoring ---

	function startAudioLevels() {
		stopAudioLevels();
		try {
			var AudioCtx = window.AudioContext || window.webkitAudioContext;
			if (!AudioCtx) return;
			state.audioLevelCtx = new AudioCtx();

			// Mic (local) analyser
			if (state.currentSession && state.currentSession.connection) {
				var senders = state.currentSession.connection.getSenders();
				for (var i = 0; i < senders.length; i++) {
					if (senders[i].track && senders[i].track.kind === 'audio') {
						var micStream = new MediaStream([senders[i].track]);
						var micSource = state.audioLevelCtx.createMediaStreamSource(micStream);
						state.micAnalyser = state.audioLevelCtx.createAnalyser();
						state.micAnalyser.fftSize = 256;
						micSource.connect(state.micAnalyser);
						break;
					}
				}
			}

			// Speaker (remote) analyser
			if (state.remoteAudio && state.remoteAudio.srcObject) {
				var spkSource = state.audioLevelCtx.createMediaStreamSource(state.remoteAudio.srcObject);
				state.spkAnalyser = state.audioLevelCtx.createAnalyser();
				state.spkAnalyser.fftSize = 256;
				spkSource.connect(state.spkAnalyser);
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

	function renderNetworkTestPanel() {
		var html = '<div class="webrtc-network-test">';
		html += '<div class="webrtc-network-test-title">Network Quality Test</div>';

		if (state.networkTestRunning) {
			html += '<div class="webrtc-network-test-running">Running tests...</div>';
		}

		var r = state.networkTestResults;
		if (r) {
			html += '<div class="webrtc-network-test-results">';
			// WSS
			if (r.wss !== null) {
				html += '<div class="webrtc-net-result ' + (r.wss.ok ? 'webrtc-net-pass' : 'webrtc-net-fail') + '">';
				html += '<span class="webrtc-net-icon">' + (r.wss.ok ? '&#10003;' : '&#10007;') + '</span>';
				html += '<span class="webrtc-net-label">WSS Server</span>';
				html += '<span class="webrtc-net-value">' + (r.wss.ok ? r.wss.time + 'ms' : escapeHtml(r.wss.error)) + '</span>';
				html += '</div>';
			}
			// STUN
			if (r.stun !== null) {
				html += '<div class="webrtc-net-result ' + (r.stun.ok ? 'webrtc-net-pass' : 'webrtc-net-fail') + '">';
				html += '<span class="webrtc-net-icon">' + (r.stun.ok ? '&#10003;' : '&#10007;') + '</span>';
				html += '<span class="webrtc-net-label">STUN Server</span>';
				html += '<span class="webrtc-net-value">' + (r.stun.ok ? r.stun.time + 'ms' + (r.stun.ip ? ' (' + escapeHtml(r.stun.ip) + ')' : '') : escapeHtml(r.stun.error)) + '</span>';
				html += '</div>';
			}
			// Latency
			if (r.latency !== null) {
				var latOk = r.latency.rtt > 0 && r.latency.rtt < 300;
				html += '<div class="webrtc-net-result ' + (r.latency.rtt > 0 ? (latOk ? 'webrtc-net-pass' : 'webrtc-net-warn') : 'webrtc-net-fail') + '">';
				html += '<span class="webrtc-net-icon">' + (r.latency.rtt > 0 ? (latOk ? '&#10003;' : '&#9888;') : '&#10007;') + '</span>';
				html += '<span class="webrtc-net-label">Latency</span>';
				html += '<span class="webrtc-net-value">' + (r.latency.rtt > 0 ? r.latency.rtt + 'ms' : escapeHtml(r.latency.error || 'N/A')) + '</span>';
				html += '</div>';
			}
			// Jitter
			if (r.jitterTest !== null) {
				html += '<div class="webrtc-net-result ' + (r.jitterTest.ok ? 'webrtc-net-pass' : 'webrtc-net-warn') + '">';
				html += '<span class="webrtc-net-icon">' + (r.jitterTest.ok ? '&#10003;' : '&#9888;') + '</span>';
				html += '<span class="webrtc-net-label">System Jitter</span>';
				html += '<span class="webrtc-net-value">' + r.jitterTest.jitter + 'ms</span>';
				html += '</div>';
			}

			// Overall verdict
			if (!state.networkTestRunning && r.wss !== null && r.stun !== null) {
				var allOk = r.wss.ok && r.stun.ok;
				html += '<div class="webrtc-net-verdict ' + (allOk ? 'webrtc-net-verdict-pass' : 'webrtc-net-verdict-fail') + '">';
				html += allOk ? 'Network is ready for VoIP calls' : 'Network issues detected - calls may have problems';
				html += '</div>';
			}
			html += '</div>';
		}

		html += '<div class="webrtc-network-test-actions">';
		if (!state.networkTestRunning) {
			html += '<button class="webrtc-btn webrtc-btn-sm webrtc-btn-primary" onclick="WebRTCPhone.runNetworkTest()">' + (r ? 'Re-test' : 'Run Test') + '</button>';
		}
		html += '<button class="webrtc-btn webrtc-btn-sm webrtc-btn-secondary" onclick="WebRTCPhone.closeNetworkTest()">Close</button>';
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
				var pc = data.peerconnection;
				var iceCompleted = false;
				var srflxTimer = null;
				var absoluteTimer = setTimeout(function () {
					if (!iceCompleted) { iceCompleted = true; clearTimeout(srflxTimer); pc.dispatchEvent(new RTCPeerConnectionIceEvent('icecandidate', { candidate: null })); }
				}, 10000);
				pc.addEventListener('icecandidate', function (e) {
					if (!e.candidate) { iceCompleted = true; clearTimeout(srflxTimer); clearTimeout(absoluteTimer); return; }
					if (e.candidate.type === 'srflx' && !iceCompleted) {
						clearTimeout(srflxTimer);
						clearTimeout(absoluteTimer);
						srflxTimer = setTimeout(function () {
							if (!iceCompleted) { iceCompleted = true; pc.dispatchEvent(new RTCPeerConnectionIceEvent('icecandidate', { candidate: null })); }
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
				if (!iceCompleted) { iceCompleted = true; clearTimeout(srflxTimer); pc.dispatchEvent(new RTCPeerConnectionIceEvent('icecandidate', { candidate: null })); }
			}, 10000);
			pc.addEventListener('icecandidate', function (e) {
				if (!e.candidate) { iceCompleted = true; clearTimeout(srflxTimer); clearTimeout(absoluteTimer); return; }
				if (e.candidate.type === 'srflx' && !iceCompleted) {
					clearTimeout(srflxTimer);
					clearTimeout(absoluteTimer);
					srflxTimer = setTimeout(function () {
						if (!iceCompleted) { iceCompleted = true; pc.dispatchEvent(new RTCPeerConnectionIceEvent('icecandidate', { candidate: null })); }
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
				html += renderTabs();
				html += state.showNetworkTest ? renderNetworkTestPanel() : (state.showHistory ? renderHistoryPanel() : renderDialPad());
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
				// Quality indicator
				html += '<div id="webrtc-quality-indicator" class="webrtc-quality-indicator webrtc-quality-unknown">';
				html += '<span class="webrtc-quality-dots">&#9675;&#9675;&#9675;&#9675;</span> <span class="webrtc-quality-label">Measuring...</span>';
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

	function renderTabs() {
		var activeTab = state.showNetworkTest ? 'network' : (state.showHistory ? 'history' : 'keypad');
		var html = '<div class="webrtc-tabs">';
		html += '<button class="webrtc-tab' + (activeTab === 'keypad' ? ' webrtc-tab-active' : '') + '" onclick="WebRTCPhone.closeHistory();WebRTCPhone.closeNetworkTest()">Keypad</button>';
		html += '<button class="webrtc-tab' + (activeTab === 'history' ? ' webrtc-tab-active' : '') + '" onclick="WebRTCPhone.closeNetworkTest();WebRTCPhone.openHistory()">Recent</button>';
		html += '<button class="webrtc-tab' + (activeTab === 'network' ? ' webrtc-tab-active' : '') + '" onclick="WebRTCPhone.closeHistory();WebRTCPhone.openNetworkTest()">Network</button>';
		html += '</div>';
		return html;
	}

	function renderHistoryPanel() {
		var html = '<div class="webrtc-history">';
		if (state.callHistory.length === 0) {
			html += '<div class="webrtc-history-empty">No recent calls</div>';
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
			html += '<button class="webrtc-btn webrtc-btn-sm webrtc-history-clear" onclick="WebRTCPhone.clearHistory()">Clear History</button>';
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
		previewRingtone: previewRingtone,
		openHistory: openHistory, closeHistory: closeHistory,
		clearHistory: clearHistory, dialFromHistory: dialFromHistory,
		openNetworkTest: openNetworkTest, closeNetworkTest: closeNetworkTest, runNetworkTest: runNetworkTest
	};

})();
