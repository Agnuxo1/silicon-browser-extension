# SiliconSignature — Multi-Platform Ecosystem

Hardware-bound image authentication using ASIC proof-of-work. Protect your AI-generated and real-world images with unforgeable signatures.

## 🔥 What is SiliconSignature?

SiliconSignature embeds **ASIC-miner-backed signatures** into images using Reed-Solomon LSB watermarking. Only someone with physical ASIC hardware (e.g., Antminer S9) can create valid signatures, but anyone can verify them offline.

### Key Features
- 🛡️ **Tamper detection** — Reed-Solomon syndrome reveals exact pixel changes
- 🌐 **Offline verification** — Pure math, no cloud, no API keys
- 🔐 **Hardware-bound** — Only physical ASIC miners can sign
- 📴 **Survives 40% editing** — Social media compression, cropping, filtering
- 💰 **$200 cost** — Used Antminer S9 vs $10K+ to attack

## 📦 Platform Availability

| Platform | Repository | Status | Language |
|----------|-----------|--------|----------|
| 🌐 Web/PWA | [siliconsignature-web](https://github.com/Agnuxo1/siliconsignature-web) | ✅ Live | HTML/JS |
| 🖥️ Browser Extension | [silicon-browser-extension](https://github.com/Agnuxo1/silicon-browser-extension) | ✅ Ready | JavaScript |
| 🎨 ComfyUI Node | [silicon-comfyui-node](https://github.com/Agnuxo1/silicon-comfyui-node) | ✅ Ready | Python |
| 🎨 A1111 Script | [silicon-a1111-script](https://github.com/Agnuxo1/silicon-a1111-script) | ✅ Ready | Python |
| 🐹 Go CLI | [siliconsignature-go](https://github.com/Agnuxo1/siliconsignature-go) | ✅ Ready | Go |
| 🦀 Rust Library | [siliconsignature-rust](https://github.com/Agnuxo1/siliconsignature-rust) | ✅ Ready | Rust/WASM |
| 📦 TypeScript/npm | [siliconsignature-ts](https://github.com/Agnuxo1/siliconsignature-ts) | ✅ Ready | TypeScript |
| 🤖 Android App | [silicon-android](https://github.com/Agnuxo1/silicon-android) | ✅ Ready | Kotlin |

## 🚀 Quick Start

### Web (No Install)
```
https://agnuxo1.github.io/siliconsignature-web/
```

### Browser Extension
```bash
git clone https://github.com/Agnuxo1/silicon-browser-extension.git
# Chrome → chrome://extensions/ → Developer Mode → Load Unpacked
```

### Go CLI
```bash
go install github.com/Agnuxo1/siliconsignature-go@latest
siliconsignature sign image.png --asic-id BM1387-001
siliconsignature verify image.png
```

### Rust
```bash
cargo add siliconsignature
```

### TypeScript
```bash
npm install @agnuxo1/siliconsignature
```

## 🔬 Technical Details

- **ASIC:** Antminer S9 BM1387 SHA256 proof-of-work
- **Error Correction:** Reed-Solomon (255,223) over GF(2^8)
- **Embedding:** LSB steganography with 5× redundancy
- **Survival:** 40% image destruction (compression, cropping, filtering)

## 📄 License

MIT — Francisco Angulo de Lafuente (@Agnuxo1)

## 🔗 Links

- **Main Project:** https://github.com/Agnuxo1/Secure_image_generation_with_ASIC_signature
- **Web App:** https://agnuxo1.github.io/siliconsignature-web/
- **Ecosystem:** https://github.com/Agnuxo1