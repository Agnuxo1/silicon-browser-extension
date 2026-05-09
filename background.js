/**
 * SiliconLens — Background Service Worker
 * Handles context menu, badge updates, and API communication
 */

const API_URL = 'https://silicon-api.p2pclaw.com';
const API_KEY = '';

// Install context menu
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'silicon-verify',
    title: '🔍 Verify Silicon Signature',
    contexts: ['image']
  });
  
  chrome.contextMenus.create({
    id: 'silicon-sign',
    title: '🔏 Sign This Image',
    contexts: ['image']
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'silicon-verify') {
    await verifyImage(info.srcUrl, tab);
  } else if (info.menuItemId === 'silicon-sign') {
    await signImage(info.srcUrl, tab);
  }
});

// Verify image from URL
async function verifyImage(imageUrl, tab) {
  try {
    // Fetch image
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    
    // Send to API
    const formData = new FormData();
    formData.append('file', blob, 'image.png');
    
    const verifyResponse = await fetch(`${API_URL}/api/v1/verify`, {
      method: 'POST',
      headers: API_KEY ? {'X-API-Key': API_KEY} : {},
      body: formData
    });
    
    const result = await verifyResponse.json();
    
    // Notify user
    chrome.notifications.create({
      type: 'basic',
      iconUrl: result.valid ? 'icons/verified.png' : 'icons/unverified.png',
      title: result.valid ? '✅ Authentic' : '❌ Not Verified',
      message: result.creator 
        ? `Signed by: ${result.creator}` 
        : 'No Silicon signature found'
    });
    
    // Send result to content script for badge
    chrome.tabs.sendMessage(tab.id, {
      action: 'verificationResult',
      imageUrl: imageUrl,
      result: result
    });
    
  } catch (err) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: '⚠️ Verification Failed',
      message: err.message
    });
  }
}

// Sign image (for user-uploaded content)
async function signImage(imageUrl, tab) {
  // Open popup with pre-filled image
  chrome.storage.local.set({pendingSignUrl: imageUrl}, () => {
    chrome.action.openPopup();
  });
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'batchVerify') {
    batchVerifyImages(request.images, sender.tab);
    sendResponse({status: 'started'});
  }
  return true;
});

// Batch verify all images on a page
async function batchVerifyImages(images, tab) {
  let verified = 0;
  let total = images.length;
  
  for (const imgUrl of images) {
    try {
      const response = await fetch(imgUrl);
      const blob = await response.blob();
      
      const formData = new FormData();
      formData.append('file', blob);
      
      const result = await fetch(`${API_URL}/api/v1/verify`, {
        method: 'POST',
        body: formData
      }).then(r => r.json());
      
      if (result.valid) verified++;
      
      // Update badge for this image
      chrome.tabs.sendMessage(tab.id, {
        action: 'badgeImage',
        imageUrl: imgUrl,
        valid: result.valid,
        creator: result.creator
      });
      
    } catch (e) {
      console.error('Verify error:', e);
    }
  }
  
  // Update extension badge
  chrome.action.setBadgeText({
    text: `${verified}/${total}`,
    tabId: tab.id
  });
  chrome.action.setBadgeBackgroundColor({
    color: verified === total ? '#00ff88' : '#ff4444'
  });
}
