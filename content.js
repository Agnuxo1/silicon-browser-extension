/**
 * content.js - Content Script for SiliconSignature
 *
 * Scans images on the current page, extracts watermarks, and adds
 * small verification indicator overlays on signed images.
 *
 * Supports:
 * - Twitter/X, Instagram, Reddit, and generic image containers
 * - Dynamic content via MutationObserver
 * - Click-to-reveal verification tooltip
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------
  const SCAN_INTERVAL_MS = 2000;
  const MIN_IMAGE_SIZE = 100; // minimum dimension to scan

  // Track processed images to avoid re-scanning
  const processedImages = new WeakSet();
  const verifiedImages = new Map(); // imgEl -> result

  // Settings
  let settings = { overlaysEnabled: true, autoScan: true };

  // ---------------------------------------------------------------------------
  // Platform Detection
  // ---------------------------------------------------------------------------
  function detectPlatform() {
    const hostname = location.hostname;
    if (hostname.includes('twitter.com') || hostname.includes('x.com')) return 'twitter';
    if (hostname.includes('instagram.com')) return 'instagram';
    if (hostname.includes('reddit.com')) return 'reddit';
    return 'generic';
  }

  const platform = detectPlatform();

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  function loadSettings() {
    chrome.storage.local.get('settings').then(data => {
      if (data.settings) {
        settings = { ...settings, ...data.settings };
        updateAllOverlays();
      }
    });
  }

  loadSettings();

  // Listen for settings updates from background/options page
  chrome.runtime.onMessage?.addListener((message) => {
    if (message.type === 'SETTINGS_UPDATED') {
      settings = { ...settings, ...message.settings };
      updateAllOverlays();
    }
  });

  // ---------------------------------------------------------------------------
  // Image Discovery
  // ---------------------------------------------------------------------------

  /**
   * Get all image elements that should be scanned.
   */
  function getAllImageElements() {
    const images = [];

    // Standard <img> tags
    document.querySelectorAll('img').forEach(img => {
      if (isValidImage(img)) images.push(img);
    });

    // CSS background images
    document.querySelectorAll('*').forEach(el => {
      const bg = getComputedStyle(el).backgroundImage;
      if (bg && bg !== 'none' && bg.includes('url(')) {
        const url = bg.replace(/url\(["']?/, '').replace(/["']?\)/, '');
        if (url && url.startsWith('http')) {
          el._ssBgUrl = url;
          images.push(el);
        }
      }
    });

    // Platform-specific containers
    if (platform === 'twitter') {
      // Twitter/X: images inside article[data-testid="tweet"]
      document.querySelectorAll('article img[src*="pbs.twimg.com"]').forEach(img => {
        if (isValidImage(img)) images.push(img);
      });
      // Also handle divs with background images for X media
      document.querySelectorAll('article [data-testid="tweetPhoto"]').forEach(el => {
        const img = el.querySelector('img');
        if (img && isValidImage(img)) images.push(img);
      });
    }

    if (platform === 'instagram') {
      // Instagram images
      document.querySelectorAll('article img').forEach(img => {
        if (isValidImage(img)) images.push(img);
      });
    }

    if (platform === 'reddit') {
      // Reddit post thumbnails and gallery images
      document.querySelectorAll('img[src*="redditmedia.com"], img[src*="redd.it"]').forEach(img => {
        if (isValidImage(img)) images.push(img);
      });
      document.querySelectorAll('[data-testid="post-container"] img').forEach(img => {
        if (isValidImage(img)) images.push(img);
      });
    }

    return [...new Set(images)];
  }

  function isValidImage(img) {
    // Skip tiny images, tracking pixels, etc.
    const w = img.naturalWidth || img.width || 0;
    const h = img.naturalHeight || img.height || 0;
    return w >= MIN_IMAGE_SIZE && h >= MIN_IMAGE_SIZE;
  }

  // ---------------------------------------------------------------------------
  // Image Processing
  // ---------------------------------------------------------------------------

  /**
   * Scan a single image for SiliconSignature watermark.
   */
  async function scanImage(imgEl) {
    if (processedImages.has(imgEl)) return null;
    processedImages.add(imgEl);

    try {
      const src = imgEl.src || imgEl._ssBgUrl || imgEl.currentSrc;
      if (!src) return null;

      // Skip data URIs that are too small (tracking pixels, etc.)
      if (src.startsWith('data:') && src.length < 1000) return null;

      const result = await extractFromImageElement(imgEl);
      if (result && result.signature) {
        verifiedImages.set(imgEl, result);
        if (settings.overlaysEnabled) {
          addOverlay(imgEl, result);
        }
        return result;
      }
    } catch (err) {
      // Silently fail for individual images
    }
    return null;
  }

  /**
   * Extract watermark from an image element by drawing to canvas.
   */
  async function extractFromImageElement(imgEl) {
    return new Promise((resolve, reject) => {
      const src = imgEl._ssBgUrl || imgEl.currentSrc || imgEl.src;

      if (imgEl._ssBgUrl) {
        // For background-image elements
        loadAndProcess(src, resolve, reject);
      } else if (imgEl.complete && imgEl.naturalWidth > 0) {
        // Image already loaded
        processImgEl(imgEl, resolve, reject);
      } else {
        // Wait for image to load
        imgEl.addEventListener('load', () => processImgEl(imgEl, resolve, reject), { once: true });
        imgEl.addEventListener('error', () => reject(new Error('Image failed to load')), { once: true });
      }
    });
  }

  function loadAndProcess(url, resolve, reject) {
    const tempImg = new Image();
    tempImg.crossOrigin = 'anonymous';
    tempImg.onload = () => processImgEl(tempImg, resolve, reject);
    tempImg.onerror = () => reject(new Error('Failed to load image'));
    tempImg.src = url;
  }

  function processImgEl(img, resolve, reject) {
    try {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;

      // Skip tiny images
      if (w < MIN_IMAGE_SIZE || h < MIN_IMAGE_SIZE) {
        resolve(null);
        return;
      }

      // Scale down for performance if image is huge
      let canvasW = w;
      let canvasH = h;
      const MAX_DIM = 2048;
      if (w > MAX_DIM || h > MAX_DIM) {
        const ratio = Math.min(MAX_DIM / w, MAX_DIM / h);
        canvasW = Math.floor(w * ratio);
        canvasH = Math.floor(h * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = canvasW;
      canvas.height = canvasH;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, canvasW, canvasH);

      const imageData = ctx.getImageData(0, 0, canvasW, canvasH);
      const result = Watermark.verifySignature(imageData);
      resolve(result);
    } catch (err) {
      reject(err);
    }
  }

  // ---------------------------------------------------------------------------
  // Overlay UI
  // ---------------------------------------------------------------------------

  function addOverlay(imgEl, result) {
    // Remove existing overlay
    removeOverlay(imgEl);

    const container = getImageContainer(imgEl);
    if (!container) return;

    container.style.position = container.style.position || 'relative';

    const badge = document.createElement('div');
    badge.className = 'ss-verified-badge';
    badge.dataset.ssOverlay = 'true';
    badge.dataset.imgSrc = imgEl.src || '';
    badge.title = 'SiliconSignature: Click for details';

    // Styling
    badge.style.cssText = `
      position: absolute;
      top: 8px;
      left: 8px;
      width: 28px;
      height: 28px;
      background: linear-gradient(135deg, #10b981, #059669);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 99999;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      font-size: 14px;
      line-height: 1;
      border: 2px solid rgba(255,255,255,0.9);
      transition: transform 0.15s ease, box-shadow 0.15s ease;
      pointer-events: auto;
      animation: ss-badge-in 0.3s ease-out;
    `;

    badge.innerHTML = '\u2714'; // checkmark
    badge.style.color = '#ffffff';

    // Add animation keyframes if not present
    if (!document.getElementById('ss-animations')) {
      const style = document.createElement('style');
      style.id = 'ss-animations';
      style.textContent = `
        @keyframes ss-badge-in {
          from { transform: scale(0); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .ss-verified-badge:hover {
          transform: scale(1.15) !important;
          box-shadow: 0 4px 16px rgba(16, 185, 129, 0.4) !important;
        }
      `;
      document.head.appendChild(style);
    }

    // Click handler: show tooltip
    badge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showTooltip(badge, result, imgEl);
    });

    container.appendChild(badge);
  }

  function removeOverlay(imgEl) {
    const container = getImageContainer(imgEl);
    if (!container) return;
    const existing = container.querySelector('[data-ss-overlay="true"]');
    if (existing) existing.remove();
  }

  function updateAllOverlays() {
    if (!settings.overlaysEnabled) {
      // Remove all overlays
      document.querySelectorAll('[data-ss-overlay="true"]').forEach(el => el.remove());
    } else {
      // Re-add for verified images
      verifiedImages.forEach((result, imgEl) => {
        if (document.contains(imgEl)) {
          addOverlay(imgEl, result);
        }
      });
    }
  }

  /**
   * Get the container element to attach the overlay badge to.
   */
  function getImageContainer(imgEl) {
    // Direct parent if it has position
    let el = imgEl;
    while (el && el !== document.body) {
      const style = getComputedStyle(el);
      if (style.position === 'relative' || style.position === 'absolute' || style.position === 'fixed') {
        return el;
      }

      // Platform-specific containers
      if (platform === 'twitter') {
        if (el.tagName === 'ARTICLE' || el.matches('[data-testid="tweetPhoto"]')) {
          el.style.position = 'relative';
          return el;
        }
      }
      if (platform === 'instagram') {
        if (el.tagName === 'ARTICLE' || el.matches('._aagu') || el.matches('._aagv')) {
          el.style.position = 'relative';
          return el;
        }
      }

      el = el.parentElement;
    }

    // Fallback: wrap in a relative container
    const wrapper = imgEl.parentElement;
    if (wrapper) {
      wrapper.style.position = wrapper.style.position || 'relative';
      return wrapper;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Tooltip
  // ---------------------------------------------------------------------------

  function showTooltip(anchorEl, result, imgEl) {
    // Remove existing tooltip
    const existing = document.getElementById('ss-verification-tooltip');
    if (existing) existing.remove();

    const sig = result.signature;
    const tooltip = document.createElement('div');
    tooltip.id = 'ss-verification-tooltip';

    const hashShort = sig.hash.substring(0, 16) + '...';
    const date = sig.timestamp
      ? new Date(sig.timestamp * 1000).toLocaleString()
      : 'Unknown';

    tooltip.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <span style="font-size:20px;">\u2705</span>
        <strong style="font-size:14px;">SiliconSignature Authentic</strong>
      </div>
      <div style="margin-bottom:6px;"><strong>Hash:</strong> ${hashShort}</div>
      <div style="margin-bottom:6px;"><strong>Nonce:</strong> ${sig.nonce}</div>
      <div style="margin-bottom:6px;"><strong>Status:</strong> ${sig.status}</div>
      <div style="margin-bottom:6px;"><strong>Time:</strong> ${date}</div>
      ${sig.creator_id ? `<div style="margin-bottom:6px;"><strong>Creator:</strong> ${sig.creator_id}</div>` : ''}
      <div style="margin-top:10px;padding-top:8px;border-top:1px solid #334155;font-size:11px;color:#94a3b8;">
        Confidence: ${(result.confidence * 100).toFixed(0)}%
        ${result.powValid ? ' &middot; PoW Verified' : ''}
      </div>
    `;

    tooltip.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      background: #1e293b;
      color: #f1f5f9;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 14px 18px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      line-height: 1.5;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      min-width: 280px;
      max-width: 360px;
      pointer-events: auto;
      animation: ss-tooltip-in 0.2s ease-out;
    `;

    document.body.appendChild(tooltip);

    // Position
    const rect = anchorEl.getBoundingClientRect();
    let left = rect.right + 8;
    let top = rect.top;

    // Keep within viewport
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (left + tooltip.offsetWidth > vw - 16) {
      left = rect.left - tooltip.offsetWidth - 8;
    }
    if (top + tooltip.offsetHeight > vh - 16) {
      top = vh - tooltip.offsetHeight - 16;
    }
    if (left < 8) left = 8;
    if (top < 8) top = rect.bottom + 8;

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';

    // Close on outside click
    setTimeout(() => {
      const closeHandler = (e) => {
        if (!tooltip.contains(e.target)) {
          tooltip.remove();
          document.removeEventListener('click', closeHandler);
          document.removeEventListener('scroll', closeHandler, true);
        }
      };
      document.addEventListener('click', closeHandler);
      document.addEventListener('scroll', closeHandler, true);
    }, 50);

    // Animation
    if (!document.getElementById('ss-tooltip-animations')) {
      const style = document.createElement('style');
      style.id = 'ss-tooltip-animations';
      style.textContent = `
        @keyframes ss-tooltip-in {
          from { transform: translateY(-4px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }
  }

  // ---------------------------------------------------------------------------
  // Page Scanning
  // ---------------------------------------------------------------------------

  async function scanAllImages() {
    if (!settings.autoScan) return;

    const images = getAllImageElements();
    const results = [];

    // Process in small batches to avoid blocking the main thread
    const BATCH_SIZE = 4;
    for (let i = 0; i < images.length; i += BATCH_SIZE) {
      const batch = images.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(img => scanImage(img).catch(() => null))
      );

      for (const r of batchResults) {
        if (r) results.push(r);
      }

      // Small delay between batches
      if (i + BATCH_SIZE < images.length) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    // Report results to background script
    if (results.length > 0) {
      chrome.runtime.sendMessage({
        type: 'SCAN_PAGE_IMAGES',
        results: results.map(r => ({
          verified: r.verified,
          integrity: r.integrity,
          confidence: r.confidence,
          signature: r.signature ? {
            hash: r.signature.hash,
            nonce: r.signature.nonce,
            status: r.signature.status,
            timestamp: r.signature.timestamp,
          } : null,
        })),
      }).catch(() => {});
    }
  }

  // ---------------------------------------------------------------------------
  // MutationObserver for dynamic content
  // ---------------------------------------------------------------------------

  let debounceTimer = null;

  function onDomMutations(mutations) {
    let hasNewImages = false;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.tagName === 'IMG' || node.querySelector?.('img')) {
            hasNewImages = true;
            break;
          }
        }
      }
      if (hasNewImages) break;
    }

    if (hasNewImages) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(scanAllImages, SCAN_INTERVAL_MS);
    }
  }

  const observer = new MutationObserver(onDomMutations);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  // Initial scan after page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(scanAllImages, 1500);
    });
  } else {
    setTimeout(scanAllImages, 1500);
  }

  // Periodic re-scan (for lazy-loaded images)
  setInterval(() => {
    if (settings.autoScan) {
      scanAllImages();
    }
  }, 8000);

  // Expose for debugging
  window.SiliconSignature = {
    scanAllImages,
    getVerifiedImages: () => Array.from(verifiedImages.values()),
    getSettings: () => settings,
    platform,
  };

})();
