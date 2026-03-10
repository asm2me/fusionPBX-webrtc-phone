# FusionPBX WebRTC Phone

A browser-based SIP softphone module for [FusionPBX](https://www.fusionpbx.com) that enables making and receiving calls directly from the web interface using WebRTC.

The phone appears as a floating dialer overlay on every FusionPBX page, automatically pulls configuration from the logged-in user's assigned extensions, and registers via SIP over WebSocket Secure (WSS) to FreeSWITCH.

---

## Features

- **Browser-based calling** - Make and receive SIP calls without any desktop softphone
- **Auto-configured from user extensions** - Reads the active user's assigned extensions from FusionPBX
- **Multi-extension support** - If a user has multiple extensions, a dropdown lets them choose which to register
- **Floating overlay** - Phone button stays in the bottom-right corner across all FusionPBX pages
- **Full dial pad** with alphanumeric sub-labels (ABC, DEF, etc.)
- **In-call controls** - Mute, Hold, DTMF, Blind Transfer
- **Incoming call notifications** - Ringtone, pulsing badge, auto-opens the phone panel
- **Call timer** with hours:minutes:seconds display
- **Call history** - Local history of recent calls with status, duration, and one-click redial
- **Audio settings** - Configurable ringtone, ring/speaker volume, mic/speaker/ring device selection
- **Real-time call quality monitoring** - Live MOS score, jitter, packet loss, RTT, and codec display during calls
- **Audio level indicators** - Visual mic and speaker level meters during active calls
- **Quality-aware header** - Phone header color changes dynamically based on call quality (green/blue/orange/red)
- **Call quality history** - Quality rating and issue reasons saved with each call in the history
- **Network quality test** - Comprehensive diagnostic tool with 6 tests:
  - WSS server connectivity
  - STUN server reachability and NAT traversal
  - SIP signaling round-trip
  - Echo test demo call (dials `*9196`, collects real RTP stats for 5 seconds)
  - Reference latency checks against Cloudflare, Google, and Microsoft
  - System jitter measurement
- **Smart network diagnosis** - Automatically determines whether quality issues originate from the user's network or the VoIP server, with confidence rating and actionable fix suggestions
- **Dark mode** support (follows system preference)
- **Standalone page** available at Apps > WebRTC Phone
- **FusionPBX native module** - follows standard app structure, permissions, menu integration, and default settings

## Screenshots

```
 ┌──────────────────────┐
 │ 1001 (John)  ● Reg.  │  ← Header with extension & status
 ├──────────────────────┤
 │  [  Extension ▼  ]   │  ← Dropdown (multi-ext users)
 │                       │
 │  ┌─────────────────┐  │
 │  │   5551234567    │  │  ← Number input
 │  └─────────────────┘  │
 │   [1] [2] [3]         │
 │   [4] [5] [6]         │  ← Dial pad
 │   [7] [8] [9]         │
 │   [*] [0] [#]         │
 │                       │
 │   [  📞 Call  ] [⌫]   │  ← Call + Backspace
 └──────────────────────┘
```

## Requirements

| Requirement | Details |
|-------------|---------|
| FusionPBX | v5.x or later |
| FreeSWITCH | With WSS (WebSocket Secure) enabled |
| SSL Certificate | Valid certificate on your domain (WebRTC requires HTTPS) |
| Browser | Chrome, Firefox, Edge, or Safari (with WebRTC support) |
| User Extensions | At least one extension assigned to the user account |

## Quick Start

### 1. Clone or Download

```bash
git clone https://github.com/YOUR_USERNAME/fusionPBX-webrtc-phone.git
```

### 2. Deploy to FusionPBX

```bash
cp -r fusionPBX-webrtc-phone /var/www/fusionpbx/app/webrtc_phone
chown -R www-data:www-data /var/www/fusionpbx/app/webrtc_phone
chmod -R 755 /var/www/fusionpbx/app/webrtc_phone
```

### 3. Register the Module

In FusionPBX, go to **Advanced > Upgrade** and click:
- **App Defaults**
- **Menu Defaults**
- **Permission Defaults**

### 4. Enable the Floating Phone

Add this line to your theme's template file (`/var/www/fusionpbx/themes/default/template.php`) before the closing `</body>` tag:

```php
<?php if (file_exists($_SERVER['DOCUMENT_ROOT'].'/app/webrtc_phone/webrtc_phone_inc.php')) {
    include $_SERVER['DOCUMENT_ROOT'].'/app/webrtc_phone/webrtc_phone_inc.php';
} ?>
```

### 5. Configure FreeSWITCH WSS

Ensure your FreeSWITCH internal SIP profile has WebSocket bindings:

```xml
<param name="ws-binding" value=":5066"/>
<param name="wss-binding" value=":7443"/>
```

Restart FreeSWITCH:
```bash
systemctl restart freeswitch
```

> See [INSTALL.md](INSTALL.md) for the full installation guide including SSL setup and troubleshooting.

## Configuration

Default settings are managed in **Advanced > Default Settings** under the `webrtc_phone` category:

| Setting | Default | Description |
|---------|---------|-------------|
| `wss_port` | `7443` | WebSocket Secure port for SIP signaling |
| `enabled` | `true` | Enable/disable the phone globally |
| `stun_server` | `stun:stun.l.google.com:19302` | STUN server for NAT traversal |

### Permissions

The `webrtc_phone_view` permission controls access. By default it is granted to:
- `superadmin`
- `admin`
- `user`

Manage permissions in **Advanced > Group Manager**.

## How It Works

```
Browser (JsSIP)  ──WSS──▶  FreeSWITCH (:7443)  ──SIP──▶  PSTN / Other Extensions
       │                        │
       │◀── RTP (WebRTC) ──────▶│
       │                        │
  FusionPBX API                 │
  (webrtc_phone_api.php)        │
       │                        │
  v_extensions ─────────────────┘
  v_extension_users
```

1. User logs into FusionPBX, the floating phone button appears
2. Phone calls `webrtc_phone_api.php` to fetch the user's extensions and WSS config
3. **Single extension** → auto-registers via JsSIP over WSS to FreeSWITCH
4. **Multiple extensions** → shows a dropdown selector, then registers the chosen one
5. Once registered, the user can dial numbers or receive incoming calls in the browser

## Module Structure

```
webrtc_phone/
├── app_config.php            # Module registration & default settings
├── app_defaults.php          # Applies defaults during upgrade
├── app_menu.php              # Adds menu entry under Apps
├── app_languages.php         # Language strings (en-us)
├── webrtc_phone.php          # Standalone phone page
├── webrtc_phone_api.php      # JSON API: returns user extensions + WSS config
├── webrtc_phone_inc.php      # Include for floating overlay injection
├── INSTALL.md                # Detailed installation guide
├── README.md                 # This file
└── resources/
    ├── css/
    │   └── webrtc_phone.css  # Phone UI styles (light + dark mode)
    └── js/
        ├── jssip.min.js      # JsSIP 3.11.1 (SIP over WebSocket library)
        └── webrtc_phone.js   # Phone application logic
```

## Technology

- **[JsSIP](https://jssip.net)** - JavaScript SIP library for WebRTC (MIT license)
- **WebRTC** - Browser-native real-time communication
- **FreeSWITCH** - SIP server with WebSocket transport
- **FusionPBX** - Web interface and multi-tenant management layer

## Call Quality Monitoring

During active calls, the phone displays real-time quality metrics:

- **MOS Score** (1.0 - 5.0) - Mean Opinion Score using the ITU-T G.107 E-model
- **Quality Rating** - Excellent (MOS >= 4.0), Good (>= 3.5), Fair (>= 2.5), Poor (< 2.5)
- **Metrics** - Jitter (ms), packet loss (%), round-trip time (ms), bitrate (kbps), codec
- **Issue Detection** - Automatically flags high jitter, packet loss, latency, and low bitrate
- **Audio Levels** - Real-time MIC and SPK level bars using Web Audio API
- **Header Color** - Phone header turns green (excellent), blue (good), orange (fair), or red (poor)

Quality data (average MOS, issues) is saved with each call in the history for later review.

## Network Quality Test

Access via the **Network** tab in the phone panel. Runs these tests:

| Test | What It Checks |
|------|---------------|
| WSS Server | WebSocket Secure connectivity to your SIP server |
| STUN Server | NAT traversal and public IP discovery |
| SIP Signaling | SIP message round-trip through the registered UA |
| Echo Test | Dials `*9196` for 5s, collects real RTP stats (packets, loss, jitter, RTT, bitrate) |
| Internet Baseline | Latency to Cloudflare, Google, and Microsoft as reference points |
| System Jitter | Local CPU/timer consistency check |

### Smart Diagnosis

After tests complete, the phone analyzes all results and provides:

- **Issue Source** - "Your Network", "VoIP Server", or "No Issues"
- **Findings** - Specific problems detected (e.g., "VoIP server response 450ms is much slower than internet baseline 40ms")
- **Suggested Fixes** - Actionable recommendations (e.g., "Switch to wired connection", "Contact administrator to check server health")

The diagnosis compares your VoIP server latency against third-party reference servers to determine fault isolation.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Status stays "Connecting..." | Check WSS port 7443 is open in firewall; verify FreeSWITCH WSS binding with `fs_cli -x "sofia status"` |
| No audio in calls | Check browser microphone permissions; verify STUN server reachability |
| "No extensions assigned" | Assign extensions to the user in Accounts > Extensions via Extension Users |
| Phone button doesn't appear | Verify the include line was added to your theme template; check user has `webrtc_phone_view` permission |
| Registration fails (Error) | Check extension password matches; verify SSL certificate is valid for WSS |
| Poor call quality | Use the Network tab to run diagnostics; check the smart diagnosis for recommendations |
| Echo test fails | Ensure FreeSWITCH extension `*9196` (echo) is enabled in your dialplan |

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -am 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

## License

This project is licensed under the **Mozilla Public License 1.1** - consistent with FusionPBX licensing.

## Acknowledgments

- [FusionPBX](https://www.fusionpbx.com) - The open source PBX platform
- [JsSIP](https://jssip.net) - SIP signaling library
- [FreeSWITCH](https://freeswitch.com) - The telephony engine
