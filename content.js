// SiliconSignature Content Script — scans images on current page

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scanImages') {
    scanImages().then(sendResponse);
    return true;
  }
});

async function scanImages() {
  const images = document.querySelectorAll('img');
  const results = [];
  for (const img of images) {
    try {
      const url = img.src;
      if (!url || url.startsWith('data:')) continue;
      const resp = await fetch(url, {mode:'no-cors'});
      const blob = await resp.blob();
      const buf = await blob.arrayBuffer();
      const verified = await quickVerify(new Uint8Array(buf));
      results.push({ url: url.slice(0,60), verified });
    } catch(e) { /* skip */ }
  }
  return results;
}

async function quickVerify(bytes) {
  // Check for SSv1 magic
  const magic = [0x53, 0x53, 0x76, 0x31];
  for (let i = 0; i < Math.min(bytes.length - 4, 0x1000); i++) {
    if (bytes[i]===magic[0] && bytes[i+1]===magic[1] && bytes[i+2]===magic[2] && bytes[i+3]===magic[3]) return true;
  }
  return false;
}
