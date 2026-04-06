#!/bin/bash
# Auto-increment build version in webrtc_phone.js and PHP files
# Run before each commit: bash bump-version.sh

cd "$(dirname "$0")"

JS="resources/js/webrtc_phone.js"
if [ ! -f "$JS" ]; then echo "ERROR: $JS not found"; exit 1; fi

# Extract current version
CURRENT=$(grep -o "BUILD_VERSION = '[0-9]*\.[0-9]*\.[0-9]*" "$JS" | grep -o "[0-9]*\.[0-9]*\.[0-9]*")
if [ -z "$CURRENT" ]; then echo "ERROR: Could not find BUILD_VERSION"; exit 1; fi

# Increment patch number
MAJOR=$(echo "$CURRENT" | cut -d. -f1)
MINOR=$(echo "$CURRENT" | cut -d. -f2)
PATCH=$(echo "$CURRENT" | cut -d. -f3)
NEWPATCH=$((PATCH + 1))
NEWVER="$MAJOR.$MINOR.$NEWPATCH"

# Update JS
sed -i "s/BUILD_VERSION = '$CURRENT-/BUILD_VERSION = '$NEWVER-/" "$JS"

# Update PHP files
for f in webrtc_phone_inc.php webrtc_phone.php; do
    if [ -f "$f" ]; then
        sed -i "s/\\\$v = '[^']*'/\\\$v = '$NEWVER'/" "$f"
    fi
done

# Rebuild minified
npx terser "$JS" --compress --mangle --output "resources/js/webrtc_phone.min.js" 2>/dev/null

echo "Version bumped: $CURRENT -> $NEWVER"
