# FusionPBX Web Phone 2 - Installation Guide

## Prerequisites

1. **FusionPBX** installed and running
2. **FreeSWITCH** configured with WebSocket support (WSS on port 7443)
3. **Valid SSL certificate** on your domain (WebRTC requires HTTPS/WSS)
4. Users must have **extensions assigned** to their FusionPBX accounts

## Installation Steps

### 1. Copy the Module

Copy the `fusionPBX-web-phone2` folder to your FusionPBX apps directory:

```bash
cp -r fusionPBX-web-phone2 /var/www/fusionpbx/app/web_phone2
```

### 2. Set Permissions

```bash
chown -R www-data:www-data /var/www/fusionpbx/app/web_phone2
chmod -R 755 /var/www/fusionpbx/app/web_phone2
```

### 3. Run the Upgrade Script

In FusionPBX, go to **Advanced > Upgrade** and click:
- **App Defaults** - registers the module and applies default settings
- **Menu Defaults** - adds the Web Phone 2 menu entry
- **Permission Defaults** - sets up permissions

Alternatively, run from the command line:
```bash
cd /var/www/fusionpbx && php core/upgrade/upgrade.php
```

### 4. Enable the Floating Phone (All Pages)

To make the phone available as a floating button on every FusionPBX page, add this line to your theme's footer file.

Edit `/var/www/fusionpbx/themes/default/template.php` (or your active theme), and add the following **before** the closing `</body>` tag:

```php
<?php if (file_exists($_SERVER['DOCUMENT_ROOT'].'/app/web_phone2/web_phone2_inc.php')) { include $_SERVER['DOCUMENT_ROOT'].'/app/web_phone2/web_phone2_inc.php'; } ?>
```

### 5. Configure FreeSWITCH for WebSocket

Ensure FreeSWITCH has WSS enabled. Edit the internal SIP profile:

```bash
nano /etc/freeswitch/sip_profiles/internal.xml
```

Ensure these parameters are present:

```xml
<param name="ws-binding" value=":5066"/>
<param name="wss-binding" value=":7443"/>
```

Restart FreeSWITCH:
```bash
systemctl restart freeswitch
```

### 6. Verify SSL

WebRTC requires WSS (secure WebSocket). Make sure your SSL certificate is configured in FreeSWITCH:

```bash
# The certificate should be at:
/etc/freeswitch/tls/wss.pem
# It should contain both the certificate and private key
```

## Configuration

### Default Settings (FusionPBX Admin)

Go to **Advanced > Default Settings** and look for the `web_phone2` category:

| Setting | Default | Description |
|---------|---------|-------------|
| `wss_port` | `7443` | WebSocket Secure port |
| `enabled` | `true` | Enable/disable globally |
| `stun_server` | `stun:stun.l.google.com:19302` | STUN server for NAT traversal |

### User Permissions

The `web_phone2_view` permission is assigned to:
- `superadmin`
- `admin`
- `user`

You can modify this in **Advanced > Group Manager**.

## How It Works

1. When a user logs in, the floating phone button appears (bottom-right corner)
2. Clicking it opens the phone dialer panel
3. The phone fetches the user's assigned extensions from FusionPBX
4. **Single extension**: Automatically connects and registers via WSS
5. **Multiple extensions**: Shows a dropdown to select which extension to use
6. Once registered, the user can make/receive calls directly in the browser

## Features

- Make and receive calls via WebRTC
- Full dial pad with DTMF support
- In-call controls: Mute, Hold, Transfer
- Incoming call notifications with ringtone
- Extension switching for multi-extension users
- Call duration timer
- Dark mode support
- Floating overlay that stays on top of all FusionPBX pages

## Clearing Cache

If the phone button doesn't appear or changes aren't taking effect, clear all caches:

### Browser Cache

**Hard Refresh (quickest):**
- **Windows/Linux:** `Ctrl + Shift + R` or `Ctrl + F5`
- **Mac:** `Cmd + Shift + R`

**Full Cache Clear:**
1. **Chrome:** `Ctrl + Shift + Delete` > Select "Cached images and files" > Clear data
2. **Firefox:** `Ctrl + Shift + Delete` > Select "Cache" > Clear Now
3. **Edge:** `Ctrl + Shift + Delete` > Select "Cached images and files" > Clear now
4. **Safari:** Develop menu > Empty Caches (enable Develop menu in Preferences > Advanced)

**Chrome DevTools (for development):**
1. Press `F12` to open DevTools
2. Right-click the browser Refresh button
3. Select **"Empty Cache and Hard Reload"**

**Disable cache during development:**
1. Open DevTools (`F12`)
2. Go to the **Network** tab
3. Check **"Disable cache"** (only active while DevTools is open)

### FusionPBX Session Cache

Log out and log back in to FusionPBX. This forces the session to reload default settings (including `web_phone2` settings).

### Server-Side Cache (if using a reverse proxy)

If you use Nginx or Apache as a reverse proxy with caching:

**Nginx:**
```bash
# Clear proxy cache
rm -rf /var/cache/nginx/*
systemctl reload nginx
```

**Apache:**
```bash
# If mod_cache is enabled
htcacheclean -r -l 0 /var/cache/apache2/mod_cache_disk
systemctl reload apache2
```

### PHP OPcache

If PHP OPcache is caching the old PHP files:

```bash
# Restart PHP-FPM to clear OPcache
systemctl restart php8.2-fpm    # adjust version as needed
```

Or add this temporarily to force a reset:
```bash
php -r "opcache_reset();"
```

### After Updating Module Files

After copying new files to the server, always:
1. Clear PHP OPcache: `systemctl restart php8.2-fpm`
2. Hard refresh the browser: `Ctrl + Shift + R`
3. If the phone still doesn't appear, log out and log back in

## Troubleshooting

### Phone button doesn't appear at all
- Verify the include line was added to your theme's `template.php` before `</body>`
- Check the user has `web_phone2_view` permission (Advanced > Group Manager)
- Verify `web_phone2` > `enabled` is set to `true` in Advanced > Default Settings
- Log out and back in to refresh the session
- Clear browser cache with `Ctrl + Shift + R`
- Check browser console (`F12`) for JavaScript errors

### Phone shows "Connecting..." but never registers
- Check that WSS port (7443) is open in your firewall
- Verify FreeSWITCH WSS binding is active: `fs_cli -x "sofia status"`
- Check browser console for WebSocket errors
- Ensure SSL certificate is valid and not expired

### No audio during calls
- Check browser microphone permissions
- Verify STUN server is reachable
- Check if ICE candidates are being exchanged (browser console)

### "No extensions assigned" error
- Go to **Accounts > Extensions** and assign extensions to the user
- The extension must be enabled and linked via **Extension Users**

## File Structure

```
web_phone2/
├── app_config.php          # Module registration
├── app_defaults.php        # Default settings installer
├── app_menu.php            # Menu entry
├── app_languages.php       # Language strings
├── web_phone2.php        # Standalone phone page
├── web_phone2_api.php    # JSON API for extension data
├── web_phone2_inc.php    # Include file for floating overlay
├── INSTALL.md              # This file
└── resources/
    ├── css/
    │   └── web_phone2.css    # Phone UI styles
    └── js/
        ├── jssip.min.js        # JsSIP library (SIP over WebSocket)
        └── web_phone2.js     # Phone application logic
```
