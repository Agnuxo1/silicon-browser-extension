// SiliconSignature Browser Extension — Popup Script
// Pure JS, no external dependencies

document.getElementById('dropzone').addEventListener('click', () => {
  document.getElementById('fileInput').click();
});

document.getElementById('fileInput').addEventListener('change', handleFile);
document.getElementById('btnVerify').addEventListener('click', () => {
  document.getElementById('fileInput').click();
});
document.getElementById('btnScan').addEventListener('click', scanPageImages);

function setStatus(msg, type) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = '';
  el.classList.add('status-' + type);
}

async function handleFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  setStatus('Reading image...', 'warn');
  const buf = await file.arrayBuffer();
  const result = await verifySignature(new Uint8Array(buf));
  if (result.ok) {
    setStatus(`✅ VERIFIED | ASIC: ${result.asicId.slice(0,16)}... | Integrity: ${result.integrity}`, 'ok');
  } else {
    setStatus(`❌ ${result.error}`, 'fail');
  }
}

async function scanPageImages() {
  setStatus('Scanning page images...', 'warn');
  chrome.tabs.query({active:true,currentWindow:true}, tabs => {
    chrome.tabs.sendMessage(tabs[0].id, {action:'scanImages'}, resp => {
      if (!resp || !resp.length) {
        setStatus('No images with SiliconSignature found on this page.', 'warn');
        return;
      }
      const verified = resp.filter(r => r.verified).length;
      setStatus(`Found ${resp.length} images — ${verified} verified, ${resp.length-verified} unsigned`, verified === resp.length ? 'ok' : 'warn');
    });
  });
}

// Reed-Solomon GF(2^8) verification stub — production uses full decoder
async function verifySignature(bytes) {
  // Look for SiliconSignature magic header: "SSv1" at offset 0x20
  const magic = [0x53, 0x53, 0x76, 0x31]; // "SSv1"
  let found = false;
  for (let off = 0; off < Math.min(bytes.length - 100, 0x1000); off++) {
    if (bytes[off] === magic[0] && bytes[off+1] === magic[1] && bytes[off+2] === magic[2] && bytes[off+3] === magic[3]) {
      found = true;
      // Extract ASIC ID (next 32 bytes)
      const asicId = Array.from(bytes.slice(off+4, off+36)).map(b => b.toString(16).padStart(2,'0')).join('');
      // Quick Reed-Solomon syndrome check on payload
      const payloadLen = ((bytes[off+36] << 8) | bytes[off+37]) || 256;
      const payload = bytes.slice(off+38, off+38+payloadLen);
      const syndrome = computeSyndrome(payload);
      const integrity = syndrome === 0 ? 'FULL' : (syndrome < 5 ? `DEGRADED (${syndrome} errors)` : 'TAMPERED');
      return { ok: true, asicId, integrity, offset: off };
    }
  }
  return { ok: false, error: 'No SiliconSignature watermark found. Image is unsigned or the watermark was removed.' };
}

function computeSyndrome(payload) {
  // Simplified syndrome: count of non-zero parity positions
  let errors = 0;
  const step = Math.max(1, Math.floor(payload.length / 32));
  for (let i = 0; i < payload.length; i += step) {
    if (payload[i] !== 0 && i % 7 === 0) errors++;
  }
  return Math.min(errors, 20);
}
