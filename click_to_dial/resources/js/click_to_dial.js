/*
	FusionPBX Click-to-Dial Widget
	Embeddable JavaScript plugin for third-party websites.
	Self-contained: includes CSS, JsSIP loader, SIP registration, and minimal phone UI.

	Flow:
	1. Visitor clicks the floating phone button
	2. Visitor fills in: Name, Phone Number, Department
	3. If multiple destinations configured, visitor picks one
	4. Widget calls the configured destination number
	5. Visitor's info is passed as Caller ID via SIP headers

	Usage:
	<script src="https://your-pbx.com/app/web_phone2/click_to_dial/resources/js/click_to_dial.js"
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
		buttonShadow: 'normal',
		buttonOrientation: 'horizontal',
		buttonStyle: 'pill',
		formStyle: 'default',
		jssipLoaded: false,
		// Visitor info
		callerName: '',
		callerPhone: '',
		callerDepartment: '',
		formSubmitted: false,
		formError: '',
		// Config from server
		destinationNumber: '',
		departments: [],
		// New state fields
		view: 'form',           // form, pick_dest, calling, in_call, ended
		destinations: [],        // array of {label, number}
		selectedDest: null,      // the chosen destination {label, number}
		lazyRegistration: false,
		showDtmf: true,
		pendingCall: false       // true when waiting for registration to complete before dialing
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
			'#ctd-container.ctd-middle-right{top:50%;right:0;transform:translateY(-50%);display:flex;align-items:center}',
			'#ctd-container.ctd-middle-left{top:50%;left:0;transform:translateY(-50%);display:flex;align-items:center;flex-direction:row-reverse}',
			// FAB
			'#ctd-fab{display:flex;align-items:center;gap:8px;padding:0 16px;height:52px;border-radius:26px;border:none;cursor:pointer;color:#fff;font-size:14px;font-weight:600;transition:transform .3s cubic-bezier(.4,0,.2,1),box-shadow .3s,background .3s;position:relative}',
			'#ctd-fab:hover{transform:scale(1.08)}',
			'#ctd-fab:active{transform:scale(.92)}',
			// FAB icon rotation when panel is open
			'#ctd-fab.ctd-fab-open svg{transform:rotate(135deg);transition:transform .3s cubic-bezier(.4,0,.2,1)}',
			'#ctd-fab svg{transition:transform .3s cubic-bezier(.4,0,.2,1)}',
			'#ctd-fab svg{width:22px;height:22px;flex-shrink:0}',
			'#ctd-fab .ctd-fab-label{white-space:nowrap}',
			'#ctd-fab.ctd-fab-icon-only{width:52px;padding:0;justify-content:center;border-radius:50%}',
			// Shadow variants
			'#ctd-fab.ctd-shadow-none{box-shadow:none}',
			'#ctd-fab.ctd-shadow-none:hover{box-shadow:none}',
			'#ctd-fab.ctd-shadow-subtle{box-shadow:0 2px 6px rgba(0,0,0,.15)}',
			'#ctd-fab.ctd-shadow-subtle:hover{box-shadow:0 3px 10px rgba(0,0,0,.2)}',
			'#ctd-fab.ctd-shadow-normal{box-shadow:0 4px 14px rgba(0,0,0,.3)}',
			'#ctd-fab.ctd-shadow-normal:hover{box-shadow:0 6px 20px rgba(0,0,0,.35)}',
			'#ctd-fab.ctd-shadow-large{box-shadow:0 8px 28px rgba(0,0,0,.4)}',
			'#ctd-fab.ctd-shadow-large:hover{box-shadow:0 12px 36px rgba(0,0,0,.45)}',
			// Vertical orientation (for docked side positions)
			'#ctd-fab.ctd-orient-vertical{writing-mode:vertical-lr;text-orientation:mixed;padding:16px 0;width:52px;height:auto;border-radius:0 26px 26px 0}',
			'#ctd-fab.ctd-orient-vertical svg{transform:rotate(0deg)}',
			'#ctd-fab.ctd-orient-vertical .ctd-fab-label{writing-mode:vertical-lr}',
			// Docked middle button shapes
			'.ctd-middle-right #ctd-fab.ctd-orient-vertical{border-radius:26px 0 0 26px}',
			'.ctd-middle-left #ctd-fab.ctd-orient-vertical{border-radius:0 26px 26px 0}',
			'.ctd-middle-right #ctd-fab.ctd-orient-horizontal{border-radius:26px 0 0 26px}',
			'.ctd-middle-left #ctd-fab.ctd-orient-horizontal{border-radius:0 26px 26px 0}',
			// Button styles
			'#ctd-fab.ctd-style-pill{border-radius:26px}',
			'#ctd-fab.ctd-style-rounded{border-radius:12px}',
			'#ctd-fab.ctd-style-square{border-radius:4px}',
			'#ctd-fab.ctd-style-circle{width:56px;height:56px;padding:0;border-radius:50%;justify-content:center}',
			'#ctd-fab.ctd-style-circle .ctd-fab-label{display:none}',
			'#ctd-fab.ctd-style-outline{background:transparent !important;border:2px solid currentColor;color:inherit}',
			'#ctd-fab.ctd-style-gradient{background:linear-gradient(135deg,var(--ctd-color),var(--ctd-color-dark)) !important}',
			'#ctd-fab.ctd-style-glass{backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);background:rgba(255,255,255,.15) !important;border:1px solid rgba(255,255,255,.25)}',
			// Form styles
			// --- Minimal: no header, clean card, floating labels feel ---
			'#ctd-panel.ctd-form-minimal .ctd-header{display:none}',
			'#ctd-panel.ctd-form-minimal{border-radius:16px;border:1px solid #e0e0e0;box-shadow:0 4px 20px rgba(0,0,0,.1)}',
			'#ctd-panel.ctd-form-minimal .ctd-body{padding:24px 20px}',
			'#ctd-panel.ctd-form-minimal .ctd-form-title{font-size:18px;margin-bottom:4px;color:#222}',
			'#ctd-panel.ctd-form-minimal .ctd-form-subtitle{margin-bottom:20px}',
			'#ctd-panel.ctd-form-minimal .ctd-field{margin-bottom:14px}',
			'#ctd-panel.ctd-form-minimal .ctd-field label{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#888;margin-bottom:6px}',
			'#ctd-panel.ctd-form-minimal .ctd-field input,#ctd-panel.ctd-form-minimal .ctd-field select{border:none;border-bottom:2px solid #e0e0e0;border-radius:0;padding:10px 2px;background:transparent}',
			'#ctd-panel.ctd-form-minimal .ctd-field input:focus,#ctd-panel.ctd-form-minimal .ctd-field select:focus{border-bottom-color:#1a73e8;box-shadow:none}',
			'#ctd-panel.ctd-form-minimal .ctd-btn{border-radius:10px;margin-top:8px}',
			// --- Bordered: strong borders, card-like fields ---
			'#ctd-panel.ctd-form-bordered .ctd-body{padding:18px 18px}',
			'#ctd-panel.ctd-form-bordered .ctd-field{margin-bottom:14px}',
			'#ctd-panel.ctd-form-bordered .ctd-field label{font-weight:700;color:#444}',
			'#ctd-panel.ctd-form-bordered .ctd-field input,#ctd-panel.ctd-form-bordered .ctd-field select{border:2px solid #bbb;border-radius:6px;padding:11px 12px;background:#fafafa}',
			'#ctd-panel.ctd-form-bordered .ctd-field input:focus,#ctd-panel.ctd-form-bordered .ctd-field select:focus{border-color:#1a73e8;background:#fff;box-shadow:0 0 0 3px rgba(26,115,232,.1)}',
			'#ctd-panel.ctd-form-bordered .ctd-btn{border:2px solid transparent;font-weight:700}',
			'#ctd-panel.ctd-form-bordered .ctd-btn-call{border-color:#388e3c}',
			'#ctd-panel.ctd-form-bordered .ctd-btn-hangup{border-color:#c62828}',
			// --- Rounded: bubbly, playful, extra padding ---
			'#ctd-panel.ctd-form-rounded{border-radius:24px;box-shadow:0 10px 40px rgba(0,0,0,.15)}',
			'#ctd-panel.ctd-form-rounded .ctd-header{border-radius:24px 24px 0 0;padding:14px 18px}',
			'#ctd-panel.ctd-form-rounded .ctd-body{padding:20px 20px}',
			'#ctd-panel.ctd-form-rounded .ctd-field{margin-bottom:14px}',
			'#ctd-panel.ctd-form-rounded .ctd-field input,#ctd-panel.ctd-form-rounded .ctd-field select{border-radius:24px;padding:12px 18px;border-color:#d0d0d0}',
			'#ctd-panel.ctd-form-rounded .ctd-btn{border-radius:24px;padding:13px}',
			'#ctd-panel.ctd-form-rounded .ctd-btn-sm{border-radius:18px;padding:9px}',
			'#ctd-panel.ctd-form-rounded .ctd-dest-btn{border-radius:16px}',
			'#ctd-panel.ctd-form-rounded .ctd-summary{border-radius:16px}',
			'#ctd-panel.ctd-form-rounded .ctd-dtmf-key{border-radius:10px}',
			// --- Compact: tight spacing, smaller everything ---
			'#ctd-panel.ctd-form-compact .ctd-body{padding:8px 10px}',
			'#ctd-panel.ctd-form-compact .ctd-field{margin-bottom:6px}',
			'#ctd-panel.ctd-form-compact .ctd-field label{font-size:10px;margin-bottom:2px}',
			'#ctd-panel.ctd-form-compact .ctd-field input,#ctd-panel.ctd-form-compact .ctd-field select{padding:7px 9px;font-size:13px;border-radius:6px}',
			'#ctd-panel.ctd-form-compact .ctd-header{padding:8px 10px}',
			'#ctd-panel.ctd-form-compact .ctd-form-title{font-size:13px;margin-bottom:4px}',
			'#ctd-panel.ctd-form-compact .ctd-form-subtitle{font-size:11px;margin-bottom:8px}',
			'#ctd-panel.ctd-form-compact .ctd-btn{padding:8px;font-size:13px;border-radius:6px}',
			'#ctd-panel.ctd-form-compact .ctd-btn-sm{padding:5px;font-size:11px}',
			'#ctd-panel.ctd-form-compact .ctd-dest-btn{padding:8px;font-size:13px;border-radius:6px}',
			'#ctd-panel.ctd-form-compact .ctd-call-icon{font-size:28px;margin-bottom:4px}',
			'#ctd-panel.ctd-form-compact .ctd-call-timer{font-size:18px}',
			// --- Dark: forced dark theme ---
			'#ctd-panel.ctd-form-dark{background:#111;color:#e0e0e0;border:1px solid #333}',
			'#ctd-panel.ctd-form-dark .ctd-header{background:#1a1a1a !important}',
			'#ctd-panel.ctd-form-dark .ctd-form-title{color:#fff}',
			'#ctd-panel.ctd-form-dark .ctd-form-subtitle{color:#777}',
			'#ctd-panel.ctd-form-dark .ctd-field label{color:#999}',
			'#ctd-panel.ctd-form-dark .ctd-field input,#ctd-panel.ctd-form-dark .ctd-field select{background:#1e1e1e;border-color:#333;color:#e0e0e0}',
			'#ctd-panel.ctd-form-dark .ctd-field input:focus,#ctd-panel.ctd-form-dark .ctd-field select:focus{border-color:#5ba3f5;box-shadow:0 0 0 3px rgba(91,163,245,.15)}',
			'#ctd-panel.ctd-form-dark .ctd-field input::placeholder{color:#555}',
			'#ctd-panel.ctd-form-dark .ctd-call-number{color:#e0e0e0}',
			'#ctd-panel.ctd-form-dark .ctd-call-label{color:#888}',
			'#ctd-panel.ctd-form-dark .ctd-call-caller{color:#777}',
			'#ctd-panel.ctd-form-dark .ctd-call-timer{color:#bbb}',
			'#ctd-panel.ctd-form-dark .ctd-btn-sm{background:#222;color:#bbb;border:1px solid #333}',
			'#ctd-panel.ctd-form-dark .ctd-btn-sm.ctd-active{background:#1a73e8;border-color:#1a73e8;color:#fff}',
			'#ctd-panel.ctd-form-dark .ctd-btn-newcall{background:#222;color:#bbb;border:1px solid #333}',
			'#ctd-panel.ctd-form-dark .ctd-summary{background:#1a1a1a;color:#999;border:1px solid #333}',
			'#ctd-panel.ctd-form-dark .ctd-summary strong{color:#e0e0e0}',
			'#ctd-panel.ctd-form-dark .ctd-dest-btn{background:#1a1a1a;border-color:#333;color:#e0e0e0}',
			'#ctd-panel.ctd-form-dark .ctd-dest-btn:hover{border-color:#5ba3f5;background:#1a2a3a}',
			'#ctd-panel.ctd-form-dark .ctd-dest-btn svg{color:#5ba3f5}',
			'#ctd-panel.ctd-form-dark .ctd-dtmf-key{background:#1e1e1e;color:#e0e0e0;border:1px solid #333}',
			'#ctd-panel.ctd-form-dark .ctd-dtmf-key:hover{background:#2a2a2a}',
			'#ctd-panel.ctd-form-dark .ctd-btn-back-link{color:#5ba3f5}',
			'#ctd-panel.ctd-form-dark .ctd-form-error{background:#2a1515;border:1px solid #4a2020;color:#f48888}',
			// --- Gradient: vibrant gradient header, accent touches ---
			'#ctd-panel.ctd-form-gradient .ctd-header{background:linear-gradient(135deg,var(--ctd-color),var(--ctd-color-dark)) !important;padding:16px 18px}',
			'#ctd-panel.ctd-form-gradient .ctd-body{padding:18px 18px}',
			'#ctd-panel.ctd-form-gradient .ctd-field{margin-bottom:14px}',
			'#ctd-panel.ctd-form-gradient .ctd-btn-call{background:linear-gradient(135deg,#43a047,#2e7d32)}',
			'#ctd-panel.ctd-form-gradient .ctd-btn-hangup{background:linear-gradient(135deg,#e53935,#c62828)}',
			'#ctd-panel.ctd-form-gradient .ctd-dest-btn:hover{background:linear-gradient(135deg,#f0f7ff,#e3f0ff)}',
			// Badge
			'.ctd-badge{position:absolute;top:-4px;right:-4px;background:#e53935;color:#fff;font-size:10px;font-weight:700;width:18px;height:18px;border-radius:50%;display:none;align-items:center;justify-content:center;animation:ctd-pulse 1.5s infinite}',
			'.ctd-badge.ctd-show{display:flex}',
			'@keyframes ctd-pulse{0%,100%{box-shadow:0 0 0 0 rgba(229,57,53,.5)}50%{box-shadow:0 0 0 8px rgba(229,57,53,0)}}',
			// Panel with animations
			'#ctd-panel{position:absolute;width:320px;background:#fff;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.25);overflow:hidden;flex-direction:column;opacity:0;transform:scale(.9) translateY(12px);pointer-events:none;transition:opacity .25s cubic-bezier(.4,0,.2,1),transform .25s cubic-bezier(.4,0,.2,1);display:flex}',
			'#ctd-panel.ctd-open{opacity:1;transform:scale(1) translateY(0);pointer-events:auto}',
			// Panel open from top positions
			'.ctd-top-right #ctd-panel,.ctd-top-left #ctd-panel{transform-origin:top right}',
			'.ctd-top-left #ctd-panel{transform-origin:top left}',
			'.ctd-bottom-right #ctd-panel{transform-origin:bottom right}',
			'.ctd-bottom-left #ctd-panel{transform-origin:bottom left}',
			'.ctd-middle-right #ctd-panel{transform-origin:center right}',
			'.ctd-middle-left #ctd-panel{transform-origin:center left}',
			'.ctd-top-right #ctd-panel,.ctd-top-left #ctd-panel{transform:scale(.9) translateY(-12px)}',
			'.ctd-top-right #ctd-panel.ctd-open,.ctd-top-left #ctd-panel.ctd-open{transform:scale(1) translateY(0)}',
			'.ctd-middle-right #ctd-panel{transform:scale(.9) translateX(12px)}',
			'.ctd-middle-right #ctd-panel.ctd-open{transform:scale(1) translateX(0) translateY(-50%)}',
			'.ctd-middle-left #ctd-panel{transform:scale(.9) translateX(-12px)}',
			'.ctd-middle-left #ctd-panel.ctd-open{transform:scale(1) translateX(0) translateY(-50%)}',
			// Content fade-in animation
			'@keyframes ctd-fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}',
			'.ctd-body{animation:ctd-fadeIn .2s ease-out}',
			'.ctd-bottom-right #ctd-panel,.ctd-bottom-left #ctd-panel{bottom:62px}',
			'.ctd-top-right #ctd-panel,.ctd-top-left #ctd-panel{top:62px}',
			'.ctd-bottom-right #ctd-panel,.ctd-top-right #ctd-panel{right:0}',
			'.ctd-bottom-left #ctd-panel,.ctd-top-left #ctd-panel{left:0}',
			'.ctd-middle-right #ctd-panel{right:62px;top:50%;transform:translateY(-50%)}',
			'.ctd-middle-left #ctd-panel{left:62px;top:50%;transform:translateY(-50%)}',
			// Header
			'.ctd-header{color:#fff;padding:12px 14px;display:flex;align-items:center;gap:8px}',
			'.ctd-header-title{flex:1;font-size:14px;font-weight:600}',
			'.ctd-header-status{font-size:11px;opacity:.8;background:rgba(255,255,255,.2);padding:2px 8px;border-radius:10px}',
			'.ctd-close-btn{background:none;border:none;color:#fff;font-size:20px;cursor:pointer;padding:0 4px;line-height:1;opacity:.8}',
			'.ctd-close-btn:hover{opacity:1}',
			// Body
			'.ctd-body{padding:18px 18px}',
			// Form styles
			'.ctd-form-title{font-size:15px;font-weight:600;color:#333;margin-bottom:6px;text-align:center}',
			'.ctd-form-subtitle{font-size:12px;color:#888;margin-bottom:16px;text-align:center}',
			'.ctd-field{margin-bottom:12px}',
			'.ctd-field label{display:block;font-size:12px;font-weight:600;color:#555;margin-bottom:5px}',
			'.ctd-field input,.ctd-field select{width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px;outline:none;transition:border-color .2s,box-shadow .2s}',
			'.ctd-field input:focus,.ctd-field select:focus{border-color:#1a73e8;box-shadow:0 0 0 3px rgba(26,115,232,.12)}',
			'.ctd-field input.ctd-input-error,.ctd-field select.ctd-input-error{border-color:#e53935;box-shadow:0 0 0 3px rgba(229,57,53,.1)}',
			'.ctd-field .ctd-field-hint{font-size:11px;color:#888;margin-top:3px}',
			'.ctd-field .ctd-field-error{font-size:11px;color:#e53935;margin-top:3px}',
			'.ctd-form-error{background:#ffebee;color:#c62828;padding:8px 12px;border-radius:8px;font-size:12px;margin-bottom:12px;text-align:center}',
			// Call button in form
			'.ctd-btn{width:100%;padding:12px;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:background .2s,transform .15s,box-shadow .2s}',
			'.ctd-btn:active{transform:scale(.97)}',
			'.ctd-btn-call{background:#43a047;color:#fff;margin-top:6px}',
			'.ctd-btn-call:hover{background:#388e3c}',
			'.ctd-btn-call:disabled{background:#bbb;cursor:default}',
			'.ctd-btn-hangup{background:#e53935;color:#fff}',
			'.ctd-btn-hangup:hover{background:#c62828}',
			'.ctd-btn-newcall{background:#f5f5f5;color:#555;margin-top:8px;font-size:13px}',
			'.ctd-btn-newcall:hover{background:#e8e8e8}',
			// Field stagger animation
			'@keyframes ctd-slideUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}',
			'.ctd-field{animation:ctd-slideUp .3s ease-out both}',
			'.ctd-field:nth-child(1){animation-delay:.05s}',
			'.ctd-field:nth-child(2){animation-delay:.1s}',
			'.ctd-field:nth-child(3){animation-delay:.15s}',
			'.ctd-field:nth-child(4){animation-delay:.2s}',
			// In-call
			'.ctd-call-info{text-align:center;padding:16px 0;animation:ctd-fadeIn .3s ease-out}',
			'.ctd-call-icon{font-size:36px;margin-bottom:8px}',
			// Ringing icon animation
			'@keyframes ctd-ring{0%,100%{transform:rotate(0)}10%{transform:rotate(14deg)}20%{transform:rotate(-14deg)}30%{transform:rotate(10deg)}40%{transform:rotate(-10deg)}50%{transform:rotate(6deg)}60%{transform:rotate(0)}}',
			'.ctd-call-icon.ctd-ringing{animation:ctd-ring 1.5s ease-in-out infinite}',
			// Connected pulse
			'@keyframes ctd-connected{0%{transform:scale(1)}50%{transform:scale(1.1)}100%{transform:scale(1)}}',
			'.ctd-call-icon.ctd-connected{animation:ctd-connected .6s ease-out}',
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
			// Destination picker
			'.ctd-dest-list{display:flex;flex-direction:column;gap:8px;margin-top:12px}',
			'.ctd-dest-btn{width:100%;padding:12px;border:2px solid #e0e0e0;border-radius:10px;background:#fff;cursor:pointer;text-align:left;font-size:14px;font-weight:500;color:#333;transition:border-color .2s,background .2s,transform .15s;display:flex;align-items:center;gap:10px;animation:ctd-slideUp .3s ease-out both}',
			'.ctd-dest-btn:nth-child(1){animation-delay:.05s}',
			'.ctd-dest-btn:nth-child(2){animation-delay:.1s}',
			'.ctd-dest-btn:nth-child(3){animation-delay:.15s}',
			'.ctd-dest-btn:nth-child(4){animation-delay:.2s}',
			'.ctd-dest-btn:nth-child(5){animation-delay:.25s}',
			'.ctd-dest-btn:hover{border-color:#1a73e8;background:#f0f7ff;transform:translateX(4px)}',
			'.ctd-dest-btn:active{transform:scale(.97)}',
			'.ctd-dest-btn svg{flex-shrink:0;color:#1a73e8;transition:transform .2s}',
			'.ctd-dest-btn:hover svg{transform:scale(1.15)}',
			'.ctd-dest-btn-label{flex:1}',
			// Caller summary
			'.ctd-summary{background:#f5f5f5;border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:#555}',
			'.ctd-summary strong{color:#333}',
			// Back button
			'.ctd-btn-back-link{display:inline-block;color:#1a73e8;font-size:13px;cursor:pointer;margin-bottom:10px;border:none;background:none;padding:0}',
			'.ctd-btn-back-link:hover{text-decoration:underline}',
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
			'.ctd-dest-btn{background:#2a2a2a;border-color:#444;color:#e0e0e0}',
			'.ctd-dest-btn:hover{border-color:#1a73e8;background:#1a3a5c}',
			'.ctd-dest-btn svg{color:#5ba3f5}',
			'.ctd-summary{background:#2a2a2a;color:#bbb}',
			'.ctd-summary strong{color:#e0e0e0}',
			'.ctd-btn-back-link{color:#5ba3f5}',
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
		console.log('CTD: Loading JsSIP from', CTD_SERVER + '/app/web_phone2/resources/js/jssip.min.js');
		var s = document.createElement('script');
		s.src = CTD_SERVER + '/app/web_phone2/resources/js/jssip.min.js';
		s.onload = function () { console.log('CTD: JsSIP loaded successfully'); state.jssipLoaded = true; callback(); };
		s.onerror = function () { console.error('CTD: Failed to load JsSIP'); renderStatus('Failed to load phone library.'); };
		document.head.appendChild(s);
	}

	// --- Fetch Config ---
	function fetchConfig(callback) {
		var apiUrl = CTD_SERVER + '/app/web_phone2/click_to_dial/click_to_dial_api.php?token=' + encodeURIComponent(CTD_TOKEN);
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

						// Parse destinations
						if (data.destinations && data.destinations.length > 0) {
							state.destinations = data.destinations;
							console.log('CTD: Multiple destinations configured:', state.destinations.length);
						} else if (data.destination_number) {
							state.destinations = [{ label: '', number: data.destination_number }];
							console.log('CTD: Single destination configured:', data.destination_number);
						} else {
							state.destinations = [];
							console.log('CTD: No destinations configured');
						}

						// Parse lazy registration
						state.lazyRegistration = !!data.lazy_registration;
						console.log('CTD: Lazy registration:', state.lazyRegistration);

						// Parse show DTMF (default true)
						state.showDtmf = (data.show_dtmf !== undefined) ? !!data.show_dtmf : true;
						console.log('CTD: Show DTMF:', state.showDtmf);

						if (data.ui) {
							state.uiColor = data.ui.button_color || '#1a73e8';
							state.position = data.ui.button_position || 'bottom-right';
							state.buttonLabel = data.ui.button_label || '';
							state.buttonShadow = data.ui.button_shadow || 'normal';
							state.buttonOrientation = data.ui.button_orientation || 'horizontal';
							state.buttonStyle = data.ui.button_style || 'pill';
							state.formStyle = data.ui.form_style || 'default';
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

				// If we have a pending call (lazy registration), trigger it now
				if (state.pendingCall) {
					state.pendingCall = false;
					try {
						var destNum = state.selectedDest ? state.selectedDest.number : null;
						console.log('CTD: Pending call detected, selectedDest:', JSON.stringify(state.selectedDest), 'destNum:', destNum);
						if (destNum) {
							makeCall(destNum);
						} else {
							console.error('CTD: Pending call but no destination selected!');
							state.view = 'form';
							state.formError = 'No destination selected. Please try again.';
							renderPanel();
						}
					} catch (err) {
						console.error('CTD: Error in pending call handler:', err);
						state.view = 'form';
						state.formError = 'Call error: ' + err.message;
						renderPanel();
					}
				} else {
					renderPanel();
				}
			});
			state.ua.on('unregistered', function () {
				console.log('CTD: SIP unregistered');
				state.registered = false;
				updateFAB();
				renderPanel();
			});
			state.ua.on('registrationFailed', function (e) {
				state.registered = false;
				console.error('CTD: SIP registration failed -', e.cause);

				// If pending call was waiting, cancel it
				if (state.pendingCall) {
					console.log('CTD: Registration failed while pending call');
					state.pendingCall = false;
					state.view = 'form';
					state.formError = 'Connection failed. Please try again.';
				}

				updateFAB();
				renderPanel();
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
			if (state.pendingCall) {
				state.pendingCall = false;
				state.view = 'form';
				state.formError = 'Connection error. Please try again.';
			}
			renderStatus('Connection error.');
		}
	}

	// --- Call Functions ---
	function makeCall(destNumber) {
		console.log('CTD: makeCall called, destNumber:', destNumber, 'ua:', !!state.ua, 'registered:', state.registered);
		if (!state.ua || !state.registered || !destNumber) {
			console.error('CTD: makeCall aborted — ua:', !!state.ua, 'registered:', state.registered, 'destNumber:', destNumber);
			return;
		}

		var domain = state.config.domain;
		var target = destNumber;
		var targetURI = 'sip:' + target + '@' + domain;

		var iceServers = [];
		if (state.config.stun_server) {
			iceServers.push({ urls: state.config.stun_server });
		}
		// Add TURN server if configured (essential for restrictive NATs/firewalls)
		if (state.config.turn_server) {
			var turnConfig = { urls: state.config.turn_server };
			if (state.config.turn_username) turnConfig.username = state.config.turn_username;
			if (state.config.turn_password) turnConfig.credential = state.config.turn_password;
			iceServers.push(turnConfig);
			// Also add TURNS (TLS) variant if using standard turn: URL
			if (state.config.turn_server.indexOf('turn:') === 0) {
				var turnsUrl = state.config.turn_server.replace('turn:', 'turns:').replace(':3478', ':5349');
				var turnsConfig = { urls: turnsUrl };
				if (state.config.turn_username) turnsConfig.username = state.config.turn_username;
				if (state.config.turn_password) turnsConfig.credential = state.config.turn_password;
				iceServers.push(turnsConfig);
			}
			console.log('CTD: TURN server configured:', state.config.turn_server);
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

				// ICE optimization: complete gathering once srflx candidate is found
				// Without this, ICE gathering hangs forever on some networks (TCP candidates timeout)
				var iceCompleted = false;
				var srflxTimer = null;
				var absoluteTimer = setTimeout(function () {
					if (!iceCompleted) {
						iceCompleted = true;
						clearTimeout(srflxTimer);
						console.log('CTD: ICE absolute timeout (10s), forcing completion');
						// Log what we have so far
						var sdp = pc.localDescription ? pc.localDescription.sdp : '';
						console.log('CTD: SDP candidates at timeout:', (sdp.match(/a=candidate/g) || []).length);
						try { pc.dispatchEvent(new RTCPeerConnectionIceEvent('icecandidate', { candidate: null })); } catch (e) {}
					}
				}, 10000);

				pc.addEventListener('icecandidate', function (e) {
					if (!e.candidate) {
						iceCompleted = true;
						clearTimeout(srflxTimer);
						clearTimeout(absoluteTimer);
						var sdp = pc.localDescription ? pc.localDescription.sdp : '';
						console.log('CTD: ICE gathering complete,', (sdp.match(/a=candidate/g) || []).length, 'candidates in SDP');
						return;
					}
					console.log('CTD: ICE candidate:', e.candidate.type, e.candidate.protocol, e.candidate.address || '');
					if (e.candidate.type === 'srflx' && !iceCompleted) {
						clearTimeout(srflxTimer);
						clearTimeout(absoluteTimer);
						srflxTimer = setTimeout(function () {
							if (!iceCompleted) {
								iceCompleted = true;
								var sdp = pc.localDescription ? pc.localDescription.sdp : '';
								console.log('CTD: srflx found, completing ICE after 500ms,', (sdp.match(/a=candidate/g) || []).length, 'candidates');
								try { pc.dispatchEvent(new RTCPeerConnectionIceEvent('icecandidate', { candidate: null })); } catch (e) {}
							}
						}, 500);
					}
				});

				pc.addEventListener('iceconnectionstatechange', function () {
					console.log('CTD: ICE connection state:', pc.iceConnectionState);
					if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
						console.log('CTD: ICE connected! RTP should flow now');
					}
					if (pc.iceConnectionState === 'failed') {
						console.error('CTD: ICE FAILED - checking candidate pairs');
						pc.getStats().then(function (stats) {
							stats.forEach(function (r) {
								if (r.type === 'candidate-pair') {
									console.log('CTD: Pair:', r.state, 'nominated:', r.nominated, 'bytesSent:', r.bytesSent, 'bytesRecv:', r.bytesReceived);
								}
								if (r.type === 'local-candidate') console.log('CTD: Local:', r.candidateType, r.protocol, r.address, r.port);
								if (r.type === 'remote-candidate') console.log('CTD: Remote:', r.candidateType, r.protocol, r.address, r.port);
							});
						}).catch(function () {});
					}
				});

				pc.addEventListener('connectionstatechange', function () {
					console.log('CTD: Peer connection state:', pc.connectionState);
					if (pc.connectionState === 'connected' && state.view === 'in_call' && !state.callTimer) startCallTimer();
				});

				pc.ontrack = function (event) {
					console.log('CTD: ontrack fired, kind:', event.track && event.track.kind);
					if (event.streams && event.streams[0]) {
						state.remoteAudio.srcObject = event.streams[0];
					} else if (event.track) {
						if (!state.remoteAudio.srcObject) state.remoteAudio.srcObject = new MediaStream();
						state.remoteAudio.srcObject.addTrack(event.track);
					}
					state.remoteAudio.play().catch(function (e) { console.warn('CTD: audio play failed', e); });
				};
			},
			'accepted': function (data) {
				console.log('CTD: Call accepted');
				// Log local SDP (our offer)
				try {
					var localSdp = state.session.connection.localDescription.sdp;
					var localCandidates = (localSdp.match(/a=candidate/g) || []).length;
					console.log('CTD: Local SDP has', localCandidates, 'candidates');
					console.log('CTD: Local SDP:\n' + localSdp);
				} catch (e) {}
				if (data && data.response && data.response.body) {
					console.log('CTD: Remote SDP (answer):\n' + data.response.body);
				}
				state.callState = 'in_call';
				state.view = 'in_call';
				renderPanel();
				// Log ICE and media state after a short delay
				setTimeout(function () { logMediaState(); }, 2000);
			},
			'confirmed': function () {
				console.log('CTD: Call confirmed');
				state.callState = 'in_call';
				state.view = 'in_call';
				if (state.session && !state.remoteAudio.srcObject) attachRemoteAudio(state.session);
				renderPanel();
				setTimeout(function () { logMediaState(); }, 2000);
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

		console.log('CTD: Calling', targetURI, 'with display name:', displayName);
		try {
			state.session = state.ua.call(targetURI, options);

			// Fix ICE negotiation with FreeSWITCH:
			// FS includes ICE credentials but doesn't properly respond to STUN
			// binding requests. Adding ice-lite to the answer tells the browser
			// that FS is a lite ICE agent, changing connectivity check behavior.
			state.session.on('sdp', function (ev) {
				if (ev.type === 'answer') {
					// Add ice-lite if not present — makes browser the controlling agent
					if (ev.sdp.indexOf('a=ice-lite') === -1) {
						ev.sdp = ev.sdp.replace(/(m=audio)/, 'a=ice-lite\r\n$1');
						console.log('CTD: Added ice-lite to answer SDP');
					}
					console.log('CTD: Modified answer SDP:\n' + ev.sdp);
				}
			});

			console.log('CTD: ua.call() succeeded, session created');
			state.callState = 'ringing_out';
			state.view = 'calling';
			state.muted = false;
			state.held = false;
			showPanel();
			renderPanel();
		} catch (e) {
			console.error('CTD: Call exception', e);
			endCall();
		}
	}

	function startCall() {
		if (!state.selectedDest) {
			console.error('CTD: No destination selected');
			return;
		}

		console.log('CTD: startCall, destination:', state.selectedDest.number, 'registered:', state.registered);

		if (state.registered) {
			// Already registered, dial immediately
			makeCall(state.selectedDest.number);
		} else {
			// Lazy registration mode: register first, then dial
			console.log('CTD: Not registered, starting lazy registration before call');
			state.pendingCall = true;
			state.view = 'calling';
			renderPanel();
			registerSIP();
		}
	}

	function logMediaState() {
		if (!state.session) { console.log('CTD: logMediaState - no session'); return; }
		try {
			var pc = state.session.connection;
			if (!pc) { console.log('CTD: logMediaState - no peer connection'); return; }
			console.log('CTD: === Media State Dump ===');
			console.log('CTD: ICE connection:', pc.iceConnectionState);
			console.log('CTD: ICE gathering:', pc.iceGatheringState);
			console.log('CTD: Connection:', pc.connectionState);
			console.log('CTD: Signaling:', pc.signalingState);

			// Local tracks (what we're sending)
			var senders = pc.getSenders();
			console.log('CTD: Senders:', senders.length);
			senders.forEach(function (s, i) {
				var t = s.track;
				console.log('CTD:   Sender[' + i + ']:', t ? (t.kind + ' enabled=' + t.enabled + ' muted=' + t.muted + ' readyState=' + t.readyState) : 'NO TRACK');
			});

			// Remote tracks (what we're receiving)
			var receivers = pc.getReceivers();
			console.log('CTD: Receivers:', receivers.length);
			receivers.forEach(function (r, i) {
				var t = r.track;
				console.log('CTD:   Receiver[' + i + ']:', t ? (t.kind + ' enabled=' + t.enabled + ' muted=' + t.muted + ' readyState=' + t.readyState) : 'NO TRACK');
			});

			// Remote audio element state
			var audio = state.remoteAudio;
			if (audio) {
				console.log('CTD: Audio element: paused=' + audio.paused + ' srcObject=' + !!audio.srcObject + ' volume=' + audio.volume);
			}

			// Get stats for candidate pairs
			pc.getStats().then(function (stats) {
				stats.forEach(function (r) {
					if (r.type === 'candidate-pair' && r.nominated) {
						console.log('CTD: Active candidate pair: local=' + r.localCandidateId + ' remote=' + r.remoteCandidateId + ' state=' + r.state + ' bytesSent=' + r.bytesSent + ' bytesRecv=' + r.bytesReceived);
					}
					if (r.type === 'local-candidate') {
						console.log('CTD: Local candidate:', r.candidateType, r.protocol, r.ip || r.address, r.port);
					}
					if (r.type === 'remote-candidate') {
						console.log('CTD: Remote candidate:', r.candidateType, r.protocol, r.ip || r.address, r.port);
					}
				});
				console.log('CTD: === End Media State ===');
			}).catch(function (e) { console.error('CTD: getStats failed', e); });
		} catch (e) {
			console.error('CTD: logMediaState error', e);
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
		state.view = 'ended';
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
		state.selectedDest = null;
		state.view = 'form';
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
		var fabClasses = ['ctd-shadow-' + state.buttonShadow, 'ctd-orient-' + state.buttonOrientation, 'ctd-style-' + state.buttonStyle];
		if (!state.buttonLabel && state.buttonStyle !== 'circle') fabClasses.push('ctd-fab-icon-only');
		fab.className = fabClasses.join(' ');
		// CSS custom properties for gradient/outline styles
		var darkerColor = darkenColor(state.uiColor, 30);
		fab.style.setProperty('--ctd-color', state.uiColor);
		fab.style.setProperty('--ctd-color-dark', darkerColor);
		if (state.buttonStyle === 'outline') {
			fab.style.color = state.uiColor;
			fab.style.background = 'transparent';
			fab.style.border = '2px solid ' + state.uiColor;
		}
		fab.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
		if (state.buttonLabel) fab.innerHTML += '<span class="ctd-fab-label">' + escapeHtml(state.buttonLabel) + '</span>';
		fab.innerHTML += '<span id="ctd-badge" class="ctd-badge"></span>';
		fab.addEventListener('click', function () { togglePanel(); });

		// Panel
		var panel = document.createElement('div');
		panel.id = 'ctd-panel';
		if (state.formStyle !== 'default') {
			panel.className = 'ctd-form-' + state.formStyle;
		}
		// Set CSS custom properties on panel too for gradient header
		panel.style.setProperty('--ctd-color', state.uiColor);
		panel.style.setProperty('--ctd-color-dark', darkerColor);

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
		var isActive = (state.view === 'calling' || state.view === 'in_call');
		var color = isActive ? '#e53935' : state.uiColor;
		if (state.buttonStyle === 'outline') {
			fab.style.background = 'transparent';
			fab.style.color = color;
			fab.style.borderColor = color;
		} else if (state.buttonStyle === 'glass') {
			fab.style.background = isActive ? 'rgba(229,57,53,.3)' : 'rgba(255,255,255,.15)';
		} else if (state.buttonStyle === 'gradient') {
			var dark = darkenColor(color, 30);
			fab.style.background = 'linear-gradient(135deg,' + color + ',' + dark + ')';
		} else {
			fab.style.background = color;
		}
	}

	function togglePanel() {
		state.visible = !state.visible;
		var panel = document.getElementById('ctd-panel');
		var fab = document.getElementById('ctd-fab');
		if (panel) {
			if (state.visible) renderPanel();
			panel.classList.toggle('ctd-open', state.visible);
		}
		if (fab) fab.classList.toggle('ctd-fab-open', state.visible);
	}

	function showPanel() {
		state.visible = true;
		var panel = document.getElementById('ctd-panel');
		var fab = document.getElementById('ctd-fab');
		if (panel) panel.classList.add('ctd-open');
		if (fab) fab.classList.add('ctd-fab-open');
	}

	function renderStatus(msg) {
		var panel = document.getElementById('ctd-panel');
		if (!panel) return;
		panel.innerHTML = renderHeader() + '<div class="ctd-body"><div class="ctd-status-msg">' + escapeHtml(msg) + '</div></div>';
	}

	function renderHeader() {
		var statusText;
		if (state.lazyRegistration && !state.registered && state.view === 'form') {
			statusText = 'Ready';
		} else {
			statusText = state.registered ? 'Ready' : 'Connecting...';
		}
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

		// Use state.view to decide what to render
		if (state.view === 'form') {
			// If not lazy and not yet registered, show connecting
			if (!state.lazyRegistration && !state.registered) {
				html += '<div class="ctd-connecting"><span class="ctd-dot"></span><span class="ctd-dot"></span><span class="ctd-dot"></span></div>';
				html += '<div class="ctd-status-msg">Connecting...</div>';
			} else {
				html += renderCallerForm();
			}
		} else if (state.view === 'pick_dest') {
			html += renderDestPicker();
		} else if (state.view === 'calling') {
			var destDisplay = state.selectedDest ? (state.selectedDest.label || state.selectedDest.number) : '';
			html += '<div class="ctd-call-info">';
			html += '<div class="ctd-call-icon ctd-ringing">&#128222;</div>';
			if (state.pendingCall) {
				html += '<div class="ctd-call-label">Connecting...</div>';
			} else {
				html += '<div class="ctd-call-label">Calling...</div>';
			}
			html += '<div class="ctd-call-number">' + escapeHtml(destDisplay) + '</div>';
			html += '<div class="ctd-call-caller">' + escapeHtml(state.callerName);
			if (state.callerDepartment) html += ' - ' + escapeHtml(state.callerDepartment);
			html += '</div>';
			html += '</div>';
			html += '<button class="ctd-btn ctd-btn-hangup" id="ctd-hangup-btn">Cancel</button>';
		} else if (state.view === 'in_call') {
			html += '<div class="ctd-call-info">';
			html += '<div class="ctd-call-icon ctd-connected" style="color:#43a047">&#128222;</div>';
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
			// DTMF pad (conditional)
			if (state.showDtmf) {
				html += '<div class="ctd-dtmf-grid">';
				var dtmfKeys = ['1','2','3','4','5','6','7','8','9','*','0','#'];
				for (var i = 0; i < dtmfKeys.length; i++) {
					html += '<button class="ctd-dtmf-key" data-dtmf="' + dtmfKeys[i] + '">' + dtmfKeys[i] + '</button>';
				}
				html += '</div>';
			}
		} else if (state.view === 'ended') {
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

		// Submit button — label depends on whether there are multiple destinations
		var hasMultipleDest = state.destinations.length >= 2;
		var btnDisabled = (!state.lazyRegistration && !state.registered) ? ' disabled' : '';
		html += '<button class="ctd-btn ctd-btn-call" id="ctd-submit-btn"' + btnDisabled + '>';
		html += '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/></svg>';
		html += hasMultipleDest ? ' Next' : ' Call Now';
		html += '</button>';

		return html;
	}

	function renderDestPicker() {
		var html = '';

		// Back button
		html += '<button class="ctd-btn-back-link" id="ctd-back-btn">&larr; Back</button>';

		// Caller summary
		html += '<div class="ctd-summary">';
		html += '<strong>' + escapeHtml(state.callerName) + '</strong> &middot; ' + escapeHtml(cleanPhone(state.callerPhone));
		if (state.callerDepartment) {
			html += ' &middot; ' + escapeHtml(state.callerDepartment);
		}
		html += '</div>';

		// Destination heading
		html += '<div class="ctd-form-title" style="font-size:14px;margin-bottom:4px">Choose who to call</div>';

		// Destination buttons
		html += '<div class="ctd-dest-list">';
		for (var i = 0; i < state.destinations.length; i++) {
			var dest = state.destinations[i];
			var btnLabel = dest.label ? ('Call ' + dest.label) : ('Call ' + dest.number);
			html += '<button class="ctd-dest-btn" data-dest-idx="' + i + '">';
			html += '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
			html += '<span class="ctd-dest-btn-label">' + escapeHtml(btnLabel) + '</span>';
			html += '</button>';
		}
		html += '</div>';

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

		// Check registration (only if not lazy mode)
		if (!state.lazyRegistration && !state.registered) {
			state.formError = 'Phone system is not ready. Please try again in a moment.';
			renderPanel();
			return;
		}

		// All valid
		state.formSubmitted = true;
		state.formError = '';
		console.log('CTD: Form submitted, name:', state.callerName, 'phone:', state.callerPhone, 'dept:', state.callerDepartment, 'destinations:', state.destinations.length);

		// Determine whether to show destination picker or dial directly
		if (state.destinations.length >= 2) {
			// Multiple destinations — show picker
			console.log('CTD: Multiple destinations, showing picker');
			state.view = 'pick_dest';
			renderPanel();
		} else if (state.destinations.length === 1) {
			// Single destination — dial immediately
			console.log('CTD: Single destination, dialing:', state.destinations[0].number);
			state.selectedDest = state.destinations[0];
			startCall();
		} else {
			// No destinations configured
			state.formError = 'No destination configured. Please contact the administrator.';
			state.formSubmitted = false;
			renderPanel();
		}
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

		// Back button (destination picker → form)
		var backBtn = document.getElementById('ctd-back-btn');
		if (backBtn) backBtn.addEventListener('click', function () {
			state.view = 'form';
			state.formSubmitted = false;
			renderPanel();
		});

		// Destination buttons
		var destBtns = document.querySelectorAll('#ctd-panel .ctd-dest-btn');
		for (var d = 0; d < destBtns.length; d++) {
			destBtns[d].addEventListener('click', function () {
				var idx = parseInt(this.getAttribute('data-dest-idx'), 10);
				if (state.destinations[idx]) {
					console.log('CTD: Destination selected:', state.destinations[idx].label, state.destinations[idx].number);
					state.selectedDest = state.destinations[idx];
					startCall();
				}
			});
		}

		// Hangup
		var hangupBtn = document.getElementById('ctd-hangup-btn');
		if (hangupBtn) hangupBtn.addEventListener('click', function () {
			if (state.pendingCall) {
				// Cancel pending call during lazy registration
				console.log('CTD: Cancelling pending call');
				state.pendingCall = false;
				state.view = 'form';
				state.formSubmitted = false;
				renderPanel();
			} else {
				hangup();
			}
		});

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

		// Call again (same info, same destination)
		var recallBtn = document.getElementById('ctd-recall-btn');
		if (recallBtn) recallBtn.addEventListener('click', function () {
			console.log('CTD: Call Again clicked');
			if (state.selectedDest) {
				state.view = 'calling';
				startCall();
			}
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
		isInCall: function () { return state.view === 'calling' || state.view === 'in_call'; },
		reset: function () { resetForm(); }
	};

	// --- Utility ---
	function escapeHtml(str) {
		if (!str) return '';
		var div = document.createElement('div');
		div.appendChild(document.createTextNode(str));
		return div.innerHTML;
	}

	function darkenColor(hex, amount) {
		hex = hex.replace('#', '');
		if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
		var r = Math.max(0, parseInt(hex.substring(0, 2), 16) - amount);
		var g = Math.max(0, parseInt(hex.substring(2, 4), 16) - amount);
		var b = Math.max(0, parseInt(hex.substring(4, 6), 16) - amount);
		return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
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
				if (state.lazyRegistration) {
					console.log('CTD: Lazy registration enabled, deferring SIP registration until call');
				} else {
					console.log('CTD: JsSIP ready, starting SIP registration');
					registerSIP();
				}
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
