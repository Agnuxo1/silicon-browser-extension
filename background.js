/**
 * background.js - Service Worker for SiliconSignature extension
 *
 * Handles:
 * - Context menu (right-click -> "Verify with SiliconSignature")
 * - Image fetch + offscreen verification
 * - Badge counter for verified images on current tab
 * - Message passing between content scripts and popup
 * - Verification history storage
 */

'use strict';

importScripts(
  'lib/reedsolomon.js',
  'lib/watermark.js'
);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CONTEXT_MENU_ID = 'siliconsignature-verify';
const STORAGE_KEY_HISTORY = 'verification_history';
const STORAGE_KEY_SETTINGS = 'settings';

// ---------------------------------------------------------------------------
// Context Menu
// ---------------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: 'Verify with SiliconSignature',
    contexts: ['image'],
    documentUrlPatterns: ['http://*/*', 'https://*/*'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === CONTEXT_MENU_ID) {
    verifyImageFromUrl(info.srcUrl, tab.id);
  }
});

// ---------------------------------------------------------------------------
// Message Handling
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'VERIFY_IMAGE') {
    verifyImageFromUrl(message.url, sender.tab?.id)
      .then(result => sendResponse({ success: true, result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // async
  }

  if (message.type === 'SCAN_PAGE_IMAGES') {
    handlePageScan(sender.tab.id, message.results);
    sendResponse({ success: true });
    return false;
  }

  if (message.type === 'GET_HISTORY') {
    getHistory().then(history => sendResponse({ history }));
    return true; // async
  }

  if (message.type === 'CLEAR_HISTORY') {
    chrome.storage.local.remove(STORAGE_KEY_HISTORY)
      .then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.type === 'GET_SETTINGS') {
    getSettings().then(settings => sendResponse({ settings }));
    return true;
  }

  if (message.type === 'SAVE_SETTINGS') {
    saveSettings(message.settings)
      .then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.type === 'QUICK_VERIFY') {
    verifyImageFromUrl(message.url, null)
      .then(result => sendResponse({ success: true, result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// ---------------------------------------------------------------------------
// Core Verification Flow
// ---------------------------------------------------------------------------

/**
 * Verify an image by URL: fetch, decode to pixels, extract watermark.
 * @param {string} imageUrl
 * @param {number|null} tabId
 * @returns {Promise<object>}
 */
async function verifyImageFromUrl(imageUrl, tabId) {
  try {
    // Fetch the image (follows redirects, handles CORS via no-cors fallback)
    const response = await fetch(imageUrl, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-cache',
    }).catch(() => fetch(imageUrl, { method: 'GET', mode: 'no-cors' }));

    if (!response.ok && response.type !== 'opaque') {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }

    const blob = await response.blob();

    // Decode image to pixels using OffscreenCanvas
    const result = await decodeAndVerify(blob);

    // Save to history
    await addToHistory(imageUrl, result);

    // Show notification
    showVerificationNotification(result, imageUrl);

    // Update badge
    if (tabId) {
      updateBadge(tabId);
    }

    return result;
  } catch (error) {
    const result = {
      verified: false,
      signature: null,
      integrity: 'NONE',
      confidence: 0.0,
      error: error.message,
      url: imageUrl,
      timestamp: Date.now(),
    };
    await addToHistory(imageUrl, result);
    return result;
  }
}

/**
 * Decode image blob to pixels using OffscreenCanvas, then verify.
 */
async function decodeAndVerify(blob) {
  // Use createImageBitmap + OffscreenCanvas (service-worker-safe)
  const bitmap = await createImageBitmap(blob);

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);

  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();

  // Extract and verify watermark
  const result = Watermark.verifySignature(imageData);
  result.width = bitmap.width;
  result.height = bitmap.height;
  result.timestamp = Date.now();

  // Attempt PoW verification if we have crypto available
  if (result.signature && result.signature.hash && result.signature.nonce) {
    try {
      const hashHex = result.signature.hash.toLowerCase();
      const nonceHex = result.signature.nonce.toLowerCase();
      const combinedStr = hashHex + nonceHex;
      const combinedBytes = hexToBytes(combinedStr);
      const hash1 = await crypto.subtle.digest('SHA-256', combinedBytes);
      const hash2 = await crypto.subtle.digest('SHA-256', hash1);
      const hashHex2 = bytesToHex(new Uint8Array(hash2));
      const hashInt = BigInt('0x' + hashHex2);
      const TARGET = 0x0000FFFF00000000000000000000000000000000000000000000000000000000n;
      result.powValid = hashInt < TARGET;
    } catch (e) {
      result.powValid = null;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Badge & Page Scan
// ---------------------------------------------------------------------------

async function handlePageScan(tabId, results) {
  const signedCount = results.filter(r => r.verified).length;

  // Update badge
  if (signedCount > 0) {
    chrome.action.setBadgeText({
      text: String(signedCount),
      tabId: tabId,
    });
    chrome.action.setBadgeBackgroundColor({
      color: '#10b981', // emerald-500
      tabId: tabId,
    });
  } else {
    chrome.action.setBadgeText({ text: '', tabId: tabId });
  }

  // Store page scan results for popup
  await chrome.storage.session.set({
    [`page_scan_${tabId}`]: {
      results,
      timestamp: Date.now(),
    },
  });
}

async function updateBadge(tabId) {
  const key = `page_scan_${tabId}`;
  const data = await chrome.storage.session.get(key);
  if (data[key]) {
    const signedCount = data[key].results.filter(r => r.verified).length;
    if (signedCount > 0) {
      chrome.action.setBadgeText({ text: String(signedCount), tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#10b981', tabId });
    }
  }
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

function showVerificationNotification(result, url) {
  const shortUrl = url.length > 50 ? url.substring(0, 50) + '...' : url;

  if (result.verified) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: '\u2705 SiliconSignature Verified',
      message: `Authentic image detected\n${shortUrl}`,
      priority: 1,
    });
  } else if (result.error) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: '\u26a0\ufe0f Verification Error',
      message: `${result.error}\n${shortUrl}`,
      priority: 0,
    });
  }
  // Don't notify for non-signed images (too noisy)
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

async function getHistory() {
  const data = await chrome.storage.local.get(STORAGE_KEY_HISTORY);
  return data[STORAGE_KEY_HISTORY] || [];
}

async function addToHistory(url, result) {
  const history = await getHistory();
  const entry = {
    url,
    ...result,
    scannedAt: Date.now(),
  };
  // Keep most recent 500 entries
  history.unshift(entry);
  if (history.length > 500) history.length = 500;
  await chrome.storage.local.set({ [STORAGE_KEY_HISTORY]: history });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function getSettings() {
  const data = await chrome.storage.local.get(STORAGE_KEY_SETTINGS);
  return Object.assign({
    overlaysEnabled: true,
    autoScan: true,
    asicEndpoint: '',
    showNotifications: true,
  }, data[STORAGE_KEY_SETTINGS]);
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ [STORAGE_KEY_SETTINGS]: settings });
  // Notify all content scripts about settings change
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'SETTINGS_UPDATED',
          settings,
        }).catch(() => {});
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Tab change: clear badge
// ---------------------------------------------------------------------------

chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.storage.session.get(`page_scan_${activeInfo.tabId}`).then(data => {
    if (data[`page_scan_${activeInfo.tabId}`]) {
      const signedCount = data[`page_scan_${activeInfo.tabId}`].results.filter(r => r.verified).length;
      if (signedCount > 0) {
        chrome.action.setBadgeText({ text: String(signedCount), tabId: activeInfo.tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#10b981', tabId: activeInfo.tabId });
      } else {
        chrome.action.setBadgeText({ text: '', tabId: activeInfo.tabId });
      }
    } else {
      chrome.action.setBadgeText({ text: '', tabId: activeInfo.tabId });
    }
  });
});

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
