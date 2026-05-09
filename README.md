# SiliconSignature Browser Extension

A browser extension that detects and verifies SiliconSignature watermarks embedded in images across the web. All verification happens locally in your browser -- no image data is ever sent to external servers.

## Features

- **Right-click any image** and select "Verify with SiliconSignature" to instantly check for an embedded cryptographic signature
- **Auto-scan** web pages for signed images with green checkmark overlays
- **Full Reed-Solomon error correction** decoder for robust watermark extraction
- **SHA-256 PoW verification** to confirm the signature's proof-of-work nonce
- **Works on Twitter/X, Instagram, Reddit**, news sites, and any webpage
- **Privacy-first**: all processing happens locally, zero external dependencies

## How It Works

1. Images are signed with a JSON payload containing a SHA-256 hash, nonce, and status
2. The payload is Reed-Solomon encoded (32 error correction symbols)
3. Encoded data is repeated 5x and embedded into the LSB of RGB channels
4. This extension extracts the LSB data, RS decodes, and verifies the signature

## Installation

### Chrome / Edge (Chromium)

1. Download the extension folder (`browser-ext/`) to your computer
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top right)
4. Click **Load unpacked** and select the `browser-ext/` folder
5. The SiliconSignature icon will appear in your toolbar

### Firefox

1. Download the extension folder (`browser-ext/`) to your computer
2. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on**
4. Select the `manifest.json` file in the `browser-ext/` folder

### Manual ZIP Install

```bash
cd browser-ext
zip -r siliconsignature.zip *
# Then load the ZIP in your browser's extension developer mode
```

## Usage

### Quick Verify (Right-Click)
1. Right-click any image on a webpage
2. Select **"Verify with SiliconSignature"**
3. See the result: green notification for authentic, or no notification for unsigned

### Page Scan
1. The extension automatically scans images as you browse
2. A badge counter on the extension icon shows how many signed images were found
3. Green checkmark badges appear on signed images (if overlays are enabled)
4. Click a checkmark badge to see full verification details

### Quick Verify URL (Popup)
1. Click the SiliconSignature icon in your toolbar
2. Paste an image URL in the **Quick Verify** field
3. Click **Verify** to check the image

### Settings
- Click the gear icon in the popup, or right-click the extension icon and choose **Options**
- Toggle overlays, auto-scan, and notifications
- Configure optional ASIC bridge endpoint
- Export/import verification history

## Keyboard Shortcut

- **Ctrl+Shift+V** (Cmd+Shift+V on Mac) -- Open the popup

## File Structure

```
browser-ext/
  manifest.json          # Extension manifest (Manifest V3)
  background.js          # Service worker for context menu + verification
  content.js             # Content script for image scanning + overlays
  popup.html             # Extension popup UI
  popup.js               # Popup logic
  popup.css              # Popup styles
  options.html           # Settings page
  options.js             # Settings logic
  options.css            # Settings styles
  README.md              # This file
  lib/
    reedsolomon.js       # Reed-Solomon GF(2^8) codec
    watermark.js         # LSB steganography extract/verify/embed
    crypto.js            # SHA-256 Web Crypto + PoW verification
  icons/
    icon.svg             # Source SVG icon
    icon16.svg           # 16px SVG icon
    icon48.svg           # 48px SVG icon
    icon16.png           # 16px PNG icon
    icon48.png           # 48px PNG icon
    icon128.png          # 128px PNG icon
```

## Technical Details

### Reed-Solomon Implementation
- **Field**: GF(2^8) with primitive polynomial `0x11d`
- **Error correction symbols**: 32 (nsym)
- **Primitive element**: alpha = 0x02
- **Generator**: Product of (x - alpha^i) for i = 0..31
- **Decoder**: Full Berlekamp-Massey algorithm with Chien search and Forney correction

### Watermark Format (SSv1)
```
JSON payload -> UTF-8 bytes -> RS encode(nsym=32)
  -> 4-byte BE length header -> 5x repeat -> bit stream
  -> LSB embed in all RGB channels
```

### Signature Payload
```json
{
  "hash": "65501a37b306f5ac183848bab643350219c18111bfa97c706856b668d3bd5996",
  "nonce": "f16823b5",
  "ntime": "6964c85e",
  "version": "20000000",
  "status": "AUTHENTICATED_BY_BM1387",
  "creator_id": "optional_creator",
  "timestamp": 1715432000
}
```

## Privacy

- **All image processing happens locally** in your browser
- No image data, URLs, or signatures are sent to any server
- Verification history is stored in local browser storage only
- Optional ASIC bridge endpoint is user-configured and off by default

## License

MIT License
