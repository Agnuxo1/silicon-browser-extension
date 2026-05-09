/**
 * popup.js - SiliconSignature Extension Popup Logic
 */

'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const els = {
    currentUrl: document.getElementById('currentUrl'),
    statTotal: document.getElementById('statTotal'),
    statSigned: document.getElementById('statSigned'),
    statVerified: document.getElementById('statVerified'),
    toggleOverlays: document.getElementById('toggleOverlays'),
    imageList: document.getElementById('imageList'),
    verifyUrl: document.getElementById('verifyUrl'),
    verifyBtn: document.getElementById('verifyBtn'),
    verifyResult: document.getElementById('verifyResult'),
    openSettings: document.getElementById('openSettings'),
  };

  // ---------------------------------------------------------------------------
  // Initialize
  // ---------------------------------------------------------------------------

  // Get current tab info
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    els.currentUrl.textContent = tab.url || 'Unknown';
  }

  // Load settings
  const settings = await getSettings();
  els.toggleOverlays.checked = settings.overlaysEnabled;

  // Load page scan results
  await loadPageResults(tab?.id);

  // Load recent history for the image list
  await loadRecentHistory();

  // ---------------------------------------------------------------------------
  // Event Listeners
  // ---------------------------------------------------------------------------

  els.toggleOverlays.addEventListener('change', async () => {
    const settings = await getSettings();
    settings.overlaysEnabled = els.toggleOverlays.checked;
    await saveSettings(settings);

    // Notify content scripts
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      chrome.tabs.sendMessage(t.id, {
        type: 'SETTINGS_UPDATED',
        settings,
      }).catch(() => {});
    }
  });

  els.verifyBtn.addEventListener('click', handleQuickVerify);
  els.verifyUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleQuickVerify();
  });

  els.openSettings.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // ---------------------------------------------------------------------------
  // Quick Verify
  // ---------------------------------------------------------------------------

  async function handleQuickVerify() {
    const url = els.verifyUrl.value.trim();
    if (!url) return;

    els.verifyBtn.disabled = true;
    showPendingResult();

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'QUICK_VERIFY',
        url,
      });

      if (response.success) {
        showVerifyResult(response.result);
      } else {
        showErrorResult(response.error || 'Verification failed');
      }
    } catch (err) {
      showErrorResult(err.message || 'Network error');
    } finally {
      els.verifyBtn.disabled = false;
    }
  }

  function showPendingResult() {
    els.verifyResult.innerHTML = `
      <div class="result-card pending">
        <div class="spinner"></div>
        <span style="color: var(--text-secondary); font-size: 12px;">Verifying image...</span>
      </div>
    `;
  }

  function showVerifyResult(result) {
    if (result.verified) {
      const sig = result.signature;
      const hashShort = sig.hash.substring(0, 20) + '...';
      els.verifyResult.innerHTML = `
        <div class="result-card success">
          <div class="result-title result-success">\u2705 Authentic SiliconSignature</div>
          <div class="result-details">
            <strong>Hash:</strong> ${hashShort}<br>
            <strong>Nonce:</strong> ${sig.nonce}<br>
            <strong>Status:</strong> ${sig.status}<br>
            ${sig.creator_id ? `<strong>Creator:</strong> ${sig.creator_id}<br>` : ''}
            ${result.powValid !== null ? `<strong>PoW:</strong> ${result.powValid ? 'Verified' : 'Invalid'}<br>` : ''}
            <strong>Confidence:</strong> ${(result.confidence * 100).toFixed(0)}%
          </div>
        </div>
      `;
    } else {
      els.verifyResult.innerHTML = `
        <div class="result-card error">
          <div class="result-title result-error">\u274c Not Signed</div>
          <div class="result-details">
            ${result.error ? `<strong>Error:</strong> ${result.error}<br>` : ''}
            ${result.integrity === 'PARTIAL' ? 'Partial watermark detected but could not be fully decoded.<br>' : 'No SiliconSignature watermark found in this image.<br>'}
            Confidence: ${(result.confidence * 100).toFixed(0)}%
          </div>
        </div>
      `;
    }
  }

  function showErrorResult(message) {
    els.verifyResult.innerHTML = `
      <div class="result-card error">
        <div class="result-title result-error">\u26a0\ufe0f Error</div>
        <div class="result-details">${message}</div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Page Results
  // ---------------------------------------------------------------------------

  async function loadPageResults(tabId) {
    if (!tabId) return;

    try {
      const data = await chrome.storage.session.get(`page_scan_${tabId}`);
      const scan = data[`page_scan_${tabId}`];
      if (scan && scan.results) {
        updateStats(scan.results);
        renderImageList(scan.results);
      }
    } catch (e) {
      // Session storage might not be available
    }
  }

  function updateStats(results) {
    const total = results.length;
    const signed = results.filter(r => r.signature).length;
    const verified = results.filter(r => r.verified).length;

    els.statTotal.textContent = total;
    els.statSigned.textContent = signed;
    els.statVerified.textContent = verified;
  }

  function renderImageList(results) {
    const signedResults = results.filter(r => r.signature);
    if (signedResults.length === 0) {
      els.imageList.innerHTML = `
        <div class="empty-state">No signed images found on this page.</div>
      `;
      return;
    }

    els.imageList.innerHTML = signedResults.map(r => {
      const sig = r.signature;
      const hashShort = sig.hash.substring(0, 18) + '...';
      const statusClass = r.verified ? 'status-verified' : r.integrity === 'PARTIAL' ? 'status-partial' : 'status-none';
      const statusText = r.verified ? 'Verified' : r.integrity === 'PARTIAL' ? 'Partial' : 'Not verified';

      return `
        <div class="image-item">
          <div class="image-item-icon">\u2705</div>
          <div class="image-item-info">
            <div class="image-item-hash">${hashShort}</div>
            <div class="image-item-status ${statusClass}">${statusText} &middot; ${sig.status}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  // ---------------------------------------------------------------------------
  // Recent History
  // ---------------------------------------------------------------------------

  async function loadRecentHistory() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' });
      const history = response.history || [];

      // Only show history if no page results
      const hasPageResults = els.imageList.querySelector('.image-item');
      if (!hasPageResults && history.length > 0) {
        renderHistoryList(history.slice(0, 5));
      }
    } catch (e) {
      // ignore
    }
  }

  function renderHistoryList(history) {
    els.imageList.innerHTML = `
      <div style="font-size:10px;color:var(--text-muted);padding-bottom:4px;">Recent verifications</div>
      ${history.map(h => {
        const sig = h.signature;
        if (!sig) return '';
        const hashShort = sig.hash.substring(0, 18) + '...';
        const statusClass = h.verified ? 'status-verified' : 'status-none';
        return `
          <div class="image-item">
            <div class="image-item-icon">${h.verified ? '\u2705' : '\u274c'}</div>
            <div class="image-item-info">
              <div class="image-item-hash">${hashShort}</div>
              <div class="image-item-status ${statusClass}">${h.verified ? 'Verified' : 'Not signed'} &middot; ${sig.status}</div>
            </div>
          </div>
        `;
      }).join('')}
    `;
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  async function getSettings() {
    const data = await chrome.storage.local.get('settings');
    return Object.assign({
      overlaysEnabled: true,
      autoScan: true,
      asicEndpoint: '',
      showNotifications: true,
    }, data.settings);
  }

  async function saveSettings(settings) {
    await chrome.storage.local.set({ settings });
  }
});
