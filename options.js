/**
 * options.js - SiliconSignature Options Page Logic
 */

'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  // DOM refs
  const els = {
    optOverlays: document.getElementById('optOverlays'),
    optAutoScan: document.getElementById('optAutoScan'),
    optNotifications: document.getElementById('optNotifications'),
    optAsicEndpoint: document.getElementById('optAsicEndpoint'),
    optVerifyPow: document.getElementById('optVerifyPow'),
    saveSettings: document.getElementById('saveSettings'),
    saveStatus: document.getElementById('saveStatus'),
    navLinks: document.querySelectorAll('.nav-link'),
    sections: document.querySelectorAll('.section'),
    historyList: document.getElementById('historyList'),
    exportHistory: document.getElementById('exportHistory'),
    importHistory: document.getElementById('importHistory'),
    importFile: document.getElementById('importFile'),
    clearHistory: document.getElementById('clearHistory'),
  };

  let settings = {};
  let originalSettings = {};

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------
  els.navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const section = link.dataset.section;

      els.navLinks.forEach(l => l.classList.remove('active'));
      link.classList.add('active');

      els.sections.forEach(s => s.classList.remove('active'));
      document.getElementById(section).classList.add('active');

      if (section === 'history') {
        loadHistory();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Load Settings
  // ---------------------------------------------------------------------------
  async function loadSettings() {
    const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    settings = response.settings;
    originalSettings = JSON.parse(JSON.stringify(settings));

    els.optOverlays.checked = settings.overlaysEnabled;
    els.optAutoScan.checked = settings.autoScan;
    els.optNotifications.checked = settings.showNotifications;
    els.optAsicEndpoint.value = settings.asicEndpoint || '';
    els.optVerifyPow.checked = settings.verifyPow !== false;
  }

  await loadSettings();

  // ---------------------------------------------------------------------------
  // Save Settings
  // ---------------------------------------------------------------------------
  async function saveCurrentSettings() {
    settings = {
      overlaysEnabled: els.optOverlays.checked,
      autoScan: els.optAutoScan.checked,
      showNotifications: els.optNotifications.checked,
      asicEndpoint: els.optAsicEndpoint.value.trim(),
      verifyPow: els.optVerifyPow.checked,
    };

    await chrome.runtime.sendMessage({
      type: 'SAVE_SETTINGS',
      settings,
    });

    originalSettings = JSON.parse(JSON.stringify(settings));
    showSaveStatus('Settings saved!', 'success');
  }

  els.saveSettings.addEventListener('click', saveCurrentSettings);

  function showSaveStatus(message, type) {
    els.saveStatus.textContent = message;
    els.saveStatus.style.color = type === 'success' ? 'var(--accent)' : 'var(--danger)';
    setTimeout(() => {
      els.saveStatus.textContent = '';
    }, 3000);
  }

  // Auto-save on toggle changes
  [els.optOverlays, els.optAutoScan, els.optNotifications, els.optVerifyPow].forEach(el => {
    el.addEventListener('change', saveCurrentSettings);
  });

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------
  async function loadHistory() {
    const response = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' });
    const history = response.history || [];

    if (history.length === 0) {
      els.historyList.innerHTML = '<div class="empty-state">No verification history yet.</div>';
      return;
    }

    els.historyList.innerHTML = history.slice(0, 100).map((h, i) => {
      const sig = h.signature;
      const isVerified = h.verified;
      const url = h.url || 'Unknown';
      const shortUrl = url.length > 60 ? url.substring(0, 60) + '...' : url;
      const date = h.scannedAt
        ? new Date(h.scannedAt).toLocaleString()
        : 'Unknown';
      const hashShort = sig?.hash ? sig.hash.substring(0, 16) + '...' : 'N/A';

      return `
        <div class="history-item">
          <div class="history-item-icon ${isVerified ? 'verified' : 'failed'}">
            ${isVerified ? '\u2705' : '\u274c'}
          </div>
          <div class="history-item-info">
            <div class="history-item-url" title="${url}">${shortUrl}</div>
            <div class="history-item-meta">
              ${isVerified ? `Hash: ${hashShort}` : h.error || 'Not signed'}
              &middot; ${date}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Export History
  els.exportHistory.addEventListener('click', async () => {
    const response = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' });
    const history = response.history || [];
    const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `siliconsignature-history-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Import History
  els.importHistory.addEventListener('click', () => {
    els.importFile.click();
  });

  els.importFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const imported = JSON.parse(text);
      if (!Array.isArray(imported)) {
        throw new Error('Invalid format: expected array');
      }

      const existing = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' });
      const merged = [...imported, ...(existing.history || [])];
      // Deduplicate by URL + scannedAt
      const seen = new Set();
      const deduped = merged.filter(h => {
        const key = (h.url || '') + '|' + (h.scannedAt || 0);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      deduped.sort((a, b) => (b.scannedAt || 0) - (a.scannedAt || 0));
      if (deduped.length > 500) deduped.length = 500;

      await chrome.storage.local.set({ verification_history: deduped });
      showSaveStatus(`Imported ${imported.length} entries`, 'success');
      loadHistory();
    } catch (err) {
      showSaveStatus('Import failed: ' + err.message, 'error');
    }
    els.importFile.value = '';
  });

  // Clear History
  els.clearHistory.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear all verification history? This cannot be undone.')) {
      await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
      loadHistory();
      showSaveStatus('History cleared', 'success');
    }
  });
});
