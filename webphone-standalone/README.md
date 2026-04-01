# Webphone Standalone

A fully self-contained browser-based SIP softphone using JsSIP and WebRTC. No server-side framework required -- just static files served over HTTPS.

---

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Deployment](#deployment)
- [Configuration](#configuration)
  - [config.js Reference](#configjs-reference)
  - [Login Behavior](#login-behavior)
  - [Multiple Extensions](#multiple-extensions)
- [Server Requirements](#server-requirements)
  - [Asterisk / FreePBX](#asterisk--freepbx)
  - [FreeSWITCH](#freeswitch)
  - [TURN Server](#turn-server)
- [CRM Integration](#crm-integration)
  - [Webhook Events](#webhook-events)
  - [Placeholders](#placeholders)
  - [Screen Pop](#screen-pop)
  - [Agent Queue](#agent-queue)
- [Programming Reference](#programming-reference)
  - [Architecture](#architecture)
  - [File Structure](#file-structure)
  - [Public API](#public-api)
  - [State Object](#state-object)
  - [localStorage Keys](#localstorage-keys)
  - [Events & Call Lifecycle](#events--call-lifecycle)
  - [SDP Handling](#sdp-handling)
  - [Audio Processing](#audio-processing)
  - [Network Quality Test](#network-quality-test)
  - [Internationalization](#internationalization)
  - [Dark Mode](#dark-mode)
- [Customization](#customization)
  - [Branding](#branding)
  - [Embedding in Another Page](#embedding-in-another-page)
  - [Adding Custom Tabs or UI](#adding-custom-tabs-or-ui)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Features

- SIP registration and calling via WebSocket Secure (WSS)
- Outbound and inbound calls with full call control (hold, mute, transfer, DTMF)
- Real-time call quality monitoring (MOS, jitter, packet loss, RTT)
- Comprehensive network diagnostics with smart diagnosis
- Call history with quality metrics (last 50 calls)
- 5 built-in ringtones (generated as WAV, no external files)
- Audio device selection (mic, speaker, ring device)
- Mic/Speaker AGC (Auto Gain Control)
- CRM integration with webhooks and screen-pop
- Agent queue login/logout
- Dark mode support (automatic via `prefers-color-scheme`)
- PDF network quality reports
- Zero server-side dependencies -- pure HTML/JS/CSS
- All configuration via a single `config.js` file

---

## Quick Start

1. Edit `config.js` with your SIP server details:

```js
var OURFONE_CONFIG = {
    domain: 'pbx.example.com',
    wss_port: '7443',
    extensions: [],
    stun_server: 'stun:stun.l.google.com:19302',
    turn_server: 'turn:turn.example.com:3478',
    turn_username: 'webrtc',
    turn_password: 'secret'
};
```

2. Serve the folder over HTTPS (required for WebRTC microphone access):

```bash
# Development (localhost is exempt from HTTPS requirement)
python -m http.server 8080

# Production -- deploy to any web server with HTTPS
scp -r webphone-standalone/ root@server:/var/www/html/webphone
```

3. Open in browser. Enter extension and password. Make calls.

---

## Deployment

### Files to Deploy

```
webphone-standalone/
  index.html                          # Main HTML page
  config.js                           # Server & account configuration
  resources/
    js/
      jssip.min.js                    # JsSIP v3.11.1 SIP library (797 KB)
      webrtc_phone.js                 # Phone application logic (189 KB)
    css/
      webrtc_phone.css                # UI styles + dark mode (28 KB)
```

Total: ~1 MB. No build step, no npm, no bundler.

### SCP Deployment

```bash
# Deploy everything
scp -r webphone-standalone/ user@server:/var/www/html/webphone

# Update only the config
scp config.js user@server:/var/www/html/webphone/

# Update only the phone logic
scp resources/js/webrtc_phone.js user@server:/var/www/html/webphone/resources/js/
```

### Nginx Configuration

```nginx
server {
    listen 443 ssl http2;
    server_name phone.example.com;

    ssl_certificate /etc/letsencrypt/live/phone.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/phone.example.com/privkey.pem;

    root /var/www/html/webphone;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### Apache Configuration

```apache
<VirtualHost *:443>
    ServerName phone.example.com
    DocumentRoot /var/www/html/webphone

    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/phone.example.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/phone.example.com/privkey.pem
</VirtualHost>
```

---

## Configuration

### config.js Reference

All configuration is in `config.js`, which defines the global `OURFONE_CONFIG` object.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `domain` | string | `''` | **Required.** SIP server hostname (e.g. `'pbx.example.com'`) |
| `wss_port` | string | `'7443'` | WebSocket Secure port. Use `'443'` for `wss://domain/wss` path |
| `extensions` | array | `[]` | Pre-configured extensions. Empty = show login form |
| `stun_server` | string | `'stun:stun.l.google.com:19302'` | STUN server URI for NAT traversal |
| `turn_server` | string | `''` | TURN server URI (e.g. `'turn:turn.example.com:3478'`) |
| `turn_username` | string | `''` | TURN authentication username |
| `turn_password` | string | `''` | TURN authentication password |
| `crm_url` | string | `''` | CRM webhook URL with placeholders |
| `crm_method` | string | `'GET'` | HTTP method for CRM webhooks (`'GET'` or `'POST'`) |
| `crm_login_url` | string | `''` | Screen-pop URL opened on incoming calls |
| `crm_auto_login_url` | string | `''` | URL opened once on page load |
| `crm_agent_login_url` | string | `''` | Webhook fired on agent queue login |
| `crm_agent_logout_url` | string | `''` | Webhook fired on agent queue logout |

#### Extension Object

Each entry in the `extensions` array:

| Property | Type | Description |
|----------|------|-------------|
| `extension` | string | SIP extension number (e.g. `'1001'`) |
| `password` | string | SIP password |
| `caller_id_name` | string | Display name shown in header |
| `caller_id_number` | string | Caller ID number |
| `description` | string | Optional description |

### Login Behavior

The phone decides what to show based on `config.js` content:

| `domain` set? | `extensions` set? | Behavior |
|:---:|:---:|---|
| No | No | Full settings page (server, STUN/TURN, CRM, credentials) |
| Yes | No | Simple login form (extension + password only) |
| Yes | Yes | Auto-connect on page load, no login needed |

When `domain` is set in `config.js`, the gear icon settings page shows only the **Account** section (extension/password/disconnect) -- server details are hidden since they come from the config file.

### Multiple Extensions

To pre-configure multiple extensions (user selects from dropdown):

```js
var OURFONE_CONFIG = {
    domain: 'pbx.example.com',
    wss_port: '7443',
    extensions: [
        { extension: '1001', password: 'pass1', caller_id_name: 'Reception', caller_id_number: '1001' },
        { extension: '1002', password: 'pass2', caller_id_name: 'Sales', caller_id_number: '1002' },
        { extension: '1003', password: 'pass3', caller_id_name: 'Support', caller_id_number: '1003' }
    ]
};
```

---

## Server Requirements

### Asterisk / FreePBX

The SIP extension must have WebRTC enabled:

```
; pjsip.conf endpoint settings
webrtc=yes
dtls_auto_generate_cert=yes
dtls_verify=no              ; IMPORTANT: must be No for browser self-signed certs
dtls_setup=actpass
media_encryption=dtls
ice_support=yes
```

**FreePBX GUI:**
1. **Applications > Extensions > Extension > Advanced**
2. Set **Media Encryption** to `DTLS`
3. Ensure **DTLS Verify** is `No`

**WSS (WebSocket) must be enabled** in Asterisk's HTTP config (`/etc/asterisk/http.conf`):

```ini
[general]
enabled=yes
bindaddr=0.0.0.0
bindport=8089
tlsenable=yes
tlsbindaddr=0.0.0.0:8089
tlscertfile=/etc/asterisk/keys/asterisk.pem
tlsprivatekey=/etc/asterisk/keys/asterisk.key
```

And in `pjsip_transports.conf`:

```ini
[transport-wss]
type=transport
protocol=wss
bind=0.0.0.0:8089
cert_file=/etc/asterisk/keys/asterisk.pem
priv_key_file=/etc/asterisk/keys/asterisk.key
```

### FreeSWITCH

WebRTC is configured in the SIP profile (typically `internal.xml`):

```xml
<param name="wss-binding" value=":7443"/>
<param name="tls-cert-dir" value="/etc/freeswitch/tls/"/>
```

The `wss_port` in `config.js` should be `'7443'` for FreeSWITCH.

### TURN Server

A TURN server is **required** when the client and server are behind different NATs (most production deployments). Without TURN, ICE negotiation will fail and there will be no audio.

**Install coturn:**

```bash
apt install coturn

# /etc/turnserver.conf
listening-port=3478
tls-listening-port=5349
realm=your-domain.com
server-name=your-domain.com
fingerprint
lt-cred-mech
user=webrtc:somepassword
total-quota=100
stale-nonce
cert=/etc/letsencrypt/live/your-domain.com/fullchain.pem
pkey=/etc/letsencrypt/live/your-domain.com/privkey.pem

systemctl enable coturn
systemctl start coturn
```

Then in `config.js`:

```js
turn_server: 'turn:your-domain.com:3478',
turn_username: 'webrtc',
turn_password: 'somepassword',
```

The phone automatically adds a `turns:` (TLS) candidate on port 5349 as fallback.

---

## CRM Integration

CRM webhooks fire directly from the browser via `fetch()` with `mode: 'no-cors'`. No server-side proxy is needed.

### Webhook Events

| Event | Trigger |
|-------|---------|
| `new_call` | Incoming call received |
| `dial_out` | Outbound call initiated |
| `answered` | Call answered (inbound or outbound) |
| `hangup` | Call ended |
| `ringing` | Remote party ringing |
| `agent_login` | Agent logs into queue |
| `agent_logout` | Agent logs out of queue |

### Placeholders

Use these in `crm_url`, `crm_login_url`, and agent URLs:

| Placeholder | Value |
|-------------|-------|
| `{event}` | Event name (e.g. `new_call`, `hangup`) |
| `{caller_id}` | Caller's number |
| `{caller_name}` | Caller's display name |
| `{destination}` | Destination number |
| `{direction}` | `inbound` or `outbound` |
| `{duration}` | Call duration in seconds |
| `{extension}` | Local extension number |
| `{call_id}` | JsSIP session ID |
| `{timestamp}` | ISO 8601 timestamp |

**Example:**

```js
crm_url: 'https://crm.example.com/api/webhook?event={event}&from={caller_id}&to={destination}&ext={extension}',
crm_method: 'GET',
crm_login_url: 'https://crm.example.com/contacts?phone={caller_id}',
```

### Screen Pop

When `crm_login_url` is set, a new browser tab/window opens automatically on each incoming call with placeholders replaced. Useful for CRM contact lookup.

### Agent Queue

When `crm_agent_login_url` or `crm_agent_logout_url` is set, a queue toggle button appears in the phone header. Clicking it fires the corresponding webhook.

---

## Programming Reference

### Architecture

```
index.html
  |
  +-- config.js          (OURFONE_CONFIG global variable)
  +-- jssip.min.js       (SIP over WebSocket library)
  +-- webrtc_phone.js    (IIFE returning WebRTCPhone object)
        |
        +-- State management (state object)
        +-- SIP registration (JsSIP.UA)
        +-- Call handling (JsSIP.RTCSession)
        +-- Audio processing (Web Audio API)
        +-- UI rendering (innerHTML-based)
        +-- Network diagnostics
        +-- CRM integration
```

The phone is a single **IIFE** (Immediately Invoked Function Expression) that returns the `WebRTCPhone` public API object. All internal state is private.

### File Structure

| File | Lines | Size | Purpose |
|------|-------|------|---------|
| `index.html` | 65 | 1.6 KB | HTML shell, loads scripts, inits phone |
| `config.js` | 45 | 1.5 KB | Server configuration (edit this) |
| `resources/js/jssip.min.js` | -- | 797 KB | JsSIP v3.11.1 library (do not modify) |
| `resources/js/webrtc_phone.js` | 4,589 | 189 KB | Phone application logic |
| `resources/css/webrtc_phone.css` | 1,468 | 28 KB | Styles + dark mode |

### Public API

The `WebRTCPhone` global object exposes these methods:

#### Initialization

| Method | Description |
|--------|-------------|
| `init(mountId)` | Initialize phone in the given DOM element ID |
| `toggle()` | Toggle phone panel visibility (for floating mode) |

#### Dialing

| Method | Description |
|--------|-------------|
| `call()` | Dial the number currently in the input field |
| `pressKey(key)` | Press a dialpad key (`'0'`-`'9'`, `'*'`, `'#'`) |
| `backspace()` | Delete last digit from dial input |
| `updateDialInput(val)` | Set the dial input value |
| `clearDial()` | Clear the dial input |
| `dialFromHistory(index)` | Dial a number from call history |

#### Call Control

| Method | Description |
|--------|-------------|
| `answer()` | Answer an incoming call |
| `reject()` | Reject an incoming call (486 Busy) |
| `hangup()` | Hang up the current call |
| `toggleMute()` | Toggle microphone mute |
| `toggleHold()` | Toggle call hold |
| `dtmf(tone)` | Send a DTMF tone during call |
| `transfer()` | Blind transfer to number in transfer input |

#### Extensions

| Method | Description |
|--------|-------------|
| `selectExtension()` | Connect with the selected extension from dropdown |
| `switchExtension(index)` | Switch to a different extension (disconnects current) |

#### Audio Settings

| Method | Description |
|--------|-------------|
| `openSettings()` | Open the audio settings panel (gear icon) |
| `closeSettings()` | Close the audio settings panel |
| `setRingtone(index)` | Set ringtone (0-4) |
| `setRingVolume(vol)` | Set ring volume (0.0 - 1.0) |
| `setSpeakerVolume(vol)` | Set speaker volume (0.0 - 1.0) |
| `setMicVolume(vol)` | Set microphone volume (0.0 - 1.0) |
| `setRingDevice(deviceId)` | Set ring output device |
| `setSpeakerDevice(deviceId)` | Set speaker output device |
| `setMicDevice(deviceId)` | Set microphone input device |
| `toggleMicAGC(enabled)` | Toggle microphone Auto Gain Control |
| `toggleSpkAGC(enabled)` | Toggle speaker Auto Gain Control |
| `previewRingtone()` | Play/stop ringtone preview |

#### Call History

| Method | Description |
|--------|-------------|
| `openHistory()` | Show call history tab |
| `closeHistory()` | Close call history tab |
| `clearHistory()` | Clear all call history |

#### Network Test

| Method | Description |
|--------|-------------|
| `openNetworkTest()` | Show network test tab |
| `closeNetworkTest()` | Close network test tab |
| `runNetworkTest()` | Start the full network diagnostic suite |
| `downloadReportPDF()` | Download network test results as PDF |

#### SIP Settings (Standalone)

| Method | Description |
|--------|-------------|
| `openSIPSettings()` | Open the full SIP settings page |
| `closeSIPSettings()` | Return from SIP settings to phone |
| `saveSIPSettings()` | Save settings form and connect |
| `disconnectSIP()` | Unregister, clear saved login, return to login |
| `loginConnect()` | Connect from the simple login form |
| `loginFromSettings()` | Connect from the settings gear account section |
| `toggleSIPSection(id)` | Toggle collapsible section in SIP settings |
| `addExtensionField()` | Add another extension fieldset |
| `removeExtensionField(i)` | Remove an extension fieldset |
| `toggleAgentStatus()` | Toggle agent queue login/logout |

### State Object

Internal state (not directly accessible) tracks:

```js
{
    initialized: false,       // Phone has been initialized
    visible: false,           // Panel is visible (floating mode)
    config: null,             // Merged config (config.js + localStorage)
    extensions: [],           // Available extensions
    selectedExtension: null,  // Currently active extension
    ua: null,                 // JsSIP.UA instance
    currentSession: null,     // Active JsSIP.RTCSession
    registered: false,        // SIP registered
    callState: 'idle',        // 'idle', 'connecting', 'ringing_out', 'ringing_in', 'in_call'
    callStatusText: '',       // Detailed status text
    muted: false,
    held: false,
    dialInput: '',
    callDuration: 0,
    agentLoggedIn: false,
    callHistory: [],          // Last 50 calls
    qualityStats: null,       // Current call quality metrics
    qualityHistory: [],       // Quality samples during call
    audioSettings: {
        ringtoneIndex: 0,     // 0-4
        ringVolume: 0.7,
        speakerVolume: 1.0,
        micVolume: 1.0,
        micAGC: false,
        spkAGC: false,
        ringDeviceId: 'default',
        speakerDeviceId: 'default',
        micDeviceId: 'default'
    }
}
```

### localStorage Keys

| Key | Content | Purpose |
|-----|---------|---------|
| `webrtc_standalone_config` | JSON | SIP server config + user credentials |
| `webrtc_phone_audio_settings` | JSON | Audio device & volume preferences |
| `webrtc_phone_call_history` | JSON | Last 50 call records with quality data |

### Events & Call Lifecycle

#### Outbound Call Flow

```
User clicks Call
  -> makeCall(target)
    -> JsSIP ua.call(targetURI)
      -> 'peerconnection' event  (ICE setup, ontrack handler)
      -> 'progress' event       (100 Trying, 180 Ringing)
      -> 'accepted' event       (200 OK, call answered)
      -> 'confirmed' event      (ACK sent, media flowing)
        -> startCallTimer()
        -> startQualityMonitor()
        -> startAudioLevels()
      -> 'ended' or 'failed'    (call terminated)
        -> endCall()
          -> stopQualityMonitor()
          -> addCallToHistory()
          -> fireCrmEvent('hangup')
```

#### Inbound Call Flow

```
JsSIP 'newRTCSession' (originator: 'remote')
  -> handleIncomingCall(session)
    -> playRingtone()
    -> showIncomingNotification()
    -> fireCrmEvent('new_call')
    -> fireCrmScreenPop()

User clicks Answer:
  -> answerCall()
    -> session.answer(options)
    -> startCallTimer()

User clicks Reject:
  -> rejectCall()
    -> session.terminate(486)
    -> endCall()
```

#### CRM Event Flow

```
Call state change
  -> fireCrmEvent(eventName)
    -> buildCrmPlaceholders()
    -> replacePlaceholders(crm_url)
    -> fetch(url, { mode: 'no-cors' })
```

### SDP Handling

The phone modifies SDP to prefer the G.711a (PCMA) codec:

```js
// In makeCall() and setupSessionListeners():
session.on('sdp', function(ev) {
    if (ev.type === 'offer') {
        ev.sdp = preferCodec(ev.sdp, 'PCMA');
    }
});
```

The `preferCodec()` function reorders payload types in the `m=audio` line to put PCMA first. Other codecs (Opus, G.722, PCMU) remain available as fallbacks.

### Audio Processing

During active calls, the phone sets up a Web Audio API chain:

```
Microphone Track
  -> MediaStreamSource
    -> [AGC: DynamicsCompressor -> MakeupGain] (optional)
      -> GainNode (mic volume)
        -> MediaStreamDestination (replaces sender track)
        -> AnalyserNode (level meter)

Remote Audio Stream
  -> <audio> element (with setSinkId for device routing)
  -> MediaStreamSource -> AnalyserNode (level meter)
  -> [Speaker AGC: dynamic volume adjustment] (optional)
```

Audio levels are sampled every 100ms and displayed as bar indicators during calls.

### Network Quality Test

The test runs 8 concurrent checks:

1. **WSS Connectivity** -- WebSocket handshake to SIP server
2. **STUN Server** -- NAT detection, discover public IP
3. **TURN Server** -- Relay connectivity (if configured)
4. **TURN Audio Stability** -- Loopback audio through TURN relay
5. **System Jitter** -- Browser timer consistency (CPU load indicator)
6. **SIP Signaling** -- SIP OPTIONS ping via registered UA
7. **Internet Baseline** -- Ping Cloudflare, Google, ISP DNS servers
8. **Path Trace** -- 12 sequential pings to SIP server + ICE analysis

After all tests complete, a **Smart Diagnosis** engine compares server latency vs. internet baseline to determine if issues originate from the user's network or the VoIP server.

#### MOS Calculation

Call quality is measured using a simplified ITU-T G.107 E-model:

```
effectiveLatency = RTT + (jitter * 2) + 10
R = 93.2 - (effectiveLatency / 40) - (packetLoss * 2.5)
MOS = 1 + 0.035 * R + R * (R - 60) * (100 - R) * 7e-6
```

| MOS | Rating |
|-----|--------|
| >= 4.0 | Excellent |
| >= 3.5 | Good |
| >= 2.5 | Fair |
| < 2.5 | Poor |

### Internationalization

The phone supports i18n through the `window.webrtcPhoneLang` object. Set it before `init()`:

```html
<script>
window.webrtcPhoneLang = {
    phone: 'Phone',
    call: 'Call',
    hangUp: 'Hang Up',
    answer: 'Answer',
    reject: 'Reject',
    mute: 'Mute',
    // ... see defaultLang in webrtc_phone.js for all keys
};
</script>
```

If a key is not found in `webrtcPhoneLang`, the built-in English default is used.

### Dark Mode

Dark mode activates automatically via CSS `@media (prefers-color-scheme: dark)`. No JavaScript toggle is needed -- it follows the system/browser setting.

---

## Customization

### Branding

Edit `index.html` to change the title and header:

```html
<div class="standalone-header">
    <h1>Your Company Phone</h1>
    <p>Internal Communications</p>
</div>
```

The user-agent string in SIP messages is set in `webrtc_phone.js`:

```js
user_agent: 'Webphone-Standalone/1.0'
```

### Embedding in Another Page

You can embed the phone in any existing page:

```html
<!-- Add a mount point -->
<div id="my-phone-mount"></div>

<!-- Load scripts -->
<script src="/webphone/config.js"></script>
<script src="/webphone/resources/js/jssip.min.js"></script>
<script src="/webphone/resources/js/webrtc_phone.js"></script>
<link rel="stylesheet" href="/webphone/resources/css/webrtc_phone.css">

<!-- Initialize -->
<script>
document.addEventListener('DOMContentLoaded', function() {
    WebRTCPhone.init('my-phone-mount');
});
</script>
```

Wrap the mount point in `#webrtc-phone-standalone` to get the bordered card style:

```html
<div id="webrtc-phone-standalone">
    <div id="my-phone-mount"></div>
</div>
```

### Adding Custom Tabs or UI

The UI is rendered via `renderPhone()` in `webrtc_phone.js`. To add a custom tab:

1. Add a button in `renderTabs()`:

```js
html += '<button class="webrtc-tab" onclick="WebRTCPhone.openMyTab()">My Tab</button>';
```

2. Add state and render function:

```js
// In state object:
showMyTab: false,

// New functions:
function openMyTab() {
    state.showMyTab = true;
    state.showHistory = false;
    state.showNetworkTest = false;
    renderPhone();
}

function renderMyTab() {
    return '<div class="webrtc-history">Your custom content</div>';
}
```

3. Add to the render logic in `renderPhone()`:

```js
if (state.showMyTab) {
    html += renderMyTab();
} else if (state.showNetworkTest) { ...
```

4. Export in the return object:

```js
return { ..., openMyTab: openMyTab };
```

---

## Troubleshooting

### "User Denied Media Access"

The browser blocked microphone access. Ensure:
- Page is served over **HTTPS** (or localhost)
- Browser has microphone permission for this site
- A physical microphone is connected

### "Incompatible SDP" / 488 Not Acceptable

Asterisk rejected the media offer. Check:
- Extension has `webrtc=yes` in PJSIP config
- `media_encryption=dtls` is set
- `dtls_verify=no` (browsers use self-signed DTLS certs)
- Asterisk was fully restarted after config changes (`fwconsole restart`)

### ICE Connected but Peer Connection Failed

DTLS handshake failure. Verify:
```bash
asterisk -rx "pjsip show endpoint 101" | grep dtls
# dtls_verify must be: No
# dtls_auto_generate_cert: Yes (or explicit cert paths)
```

### No Audio (ICE Failed / Disconnected)

NAT traversal issue. You need a TURN server:
```js
// config.js
turn_server: 'turn:your-server.com:3478',
turn_username: 'user',
turn_password: 'pass',
```

Verify TURN works by checking for `typ relay` in browser console ICE candidates.

### Registration Failed

- Check SIP domain and WSS port in `config.js`
- Verify extension credentials
- Ensure Asterisk WSS transport is enabled on the correct port
- Check firewall allows inbound connections on the WSS port

### Call Connects but No Sound

1. Check browser audio output device in Settings gear
2. Verify RTP ports (10000-20000) are open on server firewall
3. Check if `dtls_verify=no` is applied
4. Try a different TURN server

---

## License

MPL 1.1 -- Same as FusionPBX.

The standalone version is derived from the FusionPBX WebRTC Phone module but operates independently without any FusionPBX components.

**Dependencies:**
- [JsSIP v3.11.1](https://jssip.net/) -- MIT License