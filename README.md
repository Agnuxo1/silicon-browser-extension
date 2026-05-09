# SiliconSignature Browser Extension

Verify ASIC-bound image signatures directly in your browser.

## Features
- 🔍 **Verify** any image for SiliconSignature watermarks
- 🌐 **Scan** all images on the current page
- 🔐 **Hardware-bound** — only physical ASIC miners can create valid signatures
- 📴 **Offline** — no cloud, no API, pure math verification
- 🛡️ **Tamper detection** — Reed-Solomon syndrome reveals exact pixel changes

## Install
1. Download `silicon-browser-extension.zip`
2. Chrome → `chrome://extensions/` → Enable Developer Mode → Load Unpacked
3. Select the `silicon-browser-extension` folder

## Build Icons
```bash
# Convert SVG to PNG (requires ImageMagick or similar)
for size in 16 48 128; do
  convert icon${size}.svg icon${size}.png
done
```

## License
MIT — Francisco Angulo de Lafuente (@Agnuxo1)