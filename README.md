# FusionPBX Web Phone 2

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
- **Dark mode** support (follows system preference)
- **Standalone page** available at Apps > Web Phone 2
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
git clone https://github.com/YOUR_USERNAME/fusionPBX-web-phone2.git
```

### 2. Deploy to FusionPBX

```bash
cp -r fusionPBX-web-phone2 /var/www/fusionpbx/app/web_phone2
chown -R www-data:www-data /var/www/fusionpbx/app/web_phone2
chmod -R 755 /var/www/fusionpbx/app/web_phone2
```

### 3. Register the Module

In FusionPBX, go to **Advanced > Upgrade** and click:
- **App Defaults**
- **Menu Defaults**
- **Permission Defaults**

### 4. Enable the Floating Phone

Add this line to your theme's template file (`/var/www/fusionpbx/themes/default/template.php`) before the closing `</body>` tag:

```php
<?php if (file_exists($_SERVER['DOCUMENT_ROOT'].'/app/web_phone2/web_phone2_inc.php')) {
    include $_SERVER['DOCUMENT_ROOT'].'/app/web_phone2/web_phone2_inc.php';
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

Default settings are managed in **Advanced > Default Settings** under the `web_phone2` category:

| Setting | Default | Description |
|---------|---------|-------------|
| `wss_port` | `7443` | WebSocket Secure port for SIP signaling |
| `enabled` | `true` | Enable/disable the phone globally |
| `stun_server` | `stun:stun.l.google.com:19302` | STUN server for NAT traversal |

### Permissions

The `web_phone2_view` permission controls access. By default it is granted to:
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
  (web_phone2_api.php)        │
       │                        │
  v_extensions ─────────────────┘
  v_extension_users
```

1. User logs into FusionPBX, the floating phone button appears
2. Phone calls `web_phone2_api.php` to fetch the user's extensions and WSS config
3. **Single extension** → auto-registers via JsSIP over WSS to FreeSWITCH
4. **Multiple extensions** → shows a dropdown selector, then registers the chosen one
5. Once registered, the user can dial numbers or receive incoming calls in the browser

## Module Structure

```
web_phone2/
├── app_config.php            # Module registration & default settings
├── app_defaults.php          # Applies defaults during upgrade
├── app_menu.php              # Adds menu entry under Apps
├── app_languages.php         # Language strings (en-us)
├── web_phone2.php          # Standalone phone page
├── web_phone2_api.php      # JSON API: returns user extensions + WSS config
├── web_phone2_inc.php      # Include for floating overlay injection
├── INSTALL.md                # Detailed installation guide
├── README.md                 # This file
└── resources/
    ├── css/
    │   └── web_phone2.css  # Phone UI styles (light + dark mode)
    └── js/
        ├── jssip.min.js      # JsSIP 3.11.1 (SIP over WebSocket library)
        └── web_phone2.js   # Phone application logic
```

## Technology

- **[JsSIP](https://jssip.net)** - JavaScript SIP library for WebRTC (MIT license)
- **WebRTC** - Browser-native real-time communication
- **FreeSWITCH** - SIP server with WebSocket transport
- **FusionPBX** - Web interface and multi-tenant management layer

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Status stays "Connecting..." | Check WSS port 7443 is open in firewall; verify FreeSWITCH WSS binding with `fs_cli -x "sofia status"` |
| No audio in calls | Check browser microphone permissions; verify STUN server reachability |
| "No extensions assigned" | Assign extensions to the user in Accounts > Extensions via Extension Users |
| Phone button doesn't appear | Verify the include line was added to your theme template; check user has `web_phone2_view` permission |
| Registration fails (Error) | Check extension password matches; verify SSL certificate is valid for WSS |

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
