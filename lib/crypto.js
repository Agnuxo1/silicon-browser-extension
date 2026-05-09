/**
 * crypto.js - SHA-256 via Web Crypto API + nonce verification
 *
 * Provides:
 *   sha256(data) -> hex string
 *   sha256Double(data) -> hex string (SHA-256(SHA-256(data)))
 *   verifyNonce(hash, nonce) -> boolean (checks PoW difficulty)
 *   generateNonce() -> random 8-char hex nonce
 *   TARGET_DIFFICULTY (BigInt)
 */

(function (global) {
  'use strict';

  // Target difficulty for software signing mode
  const TARGET_DIFFICULTY = 0x0000FFFF00000000000000000000000000000000000000000000000000000000n;

  /**
   * Compute SHA-256 digest, return hex string.
   * @param {string|Uint8Array} data
   * @returns {Promise<string>} hex-encoded hash
   */
  async function sha256(data) {
    let bytes;
    if (typeof data === 'string') {
      bytes = new TextEncoder().encode(data);
    } else if (data instanceof Uint8Array) {
      bytes = data;
    } else {
      throw new Error('sha256: expected string or Uint8Array');
    }
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
    return bufToHex(new Uint8Array(hashBuffer));
  }

  /**
   * Double SHA-256: SHA-256(SHA-256(data))
   * Used by Bitcoin-style PoW.
   * @param {string|Uint8Array} data
   * @returns {Promise<string>} hex-encoded double hash
   */
  async function sha256Double(data) {
    const first = await sha256(data);
    return sha256(hexToBuf(first));
  }

  /**
   * Verify a nonce satisfies the PoW difficulty target.
   * hash256 = SHA-256(SHA-256(hashHex || nonceHex))
   * Check: hash256 as big-endian integer < TARGET_DIFFICULTY
   * @param {string} hashHex - 64-char hex SHA-256 of image
   * @param {string} nonceHex - 8-char hex nonce
   * @returns {Promise<boolean>}
   */
  async function verifyNonce(hashHex, nonceHex) {
    const combined = hexToBuf(hashHex + nonceHex);
    const hash256 = await sha256Double(combined);
    const hashInt = BigInt('0x' + hash256);
    return hashInt < TARGET_DIFFICULTY;
  }

  /**
   * Search for a nonce such that SHA-256(SHA-256(hash || nonce)) < target.
   * This is the software (CPU) signing mode that simulates ASIC PoW.
   * @param {string} hashHex - 64-char hex SHA-256
   * @param {number} maxAttempts - max iterations (default 1e7)
   * @returns {Promise<{nonce: string, found: boolean}>}
   */
  async function findNonce(hashHex, maxAttempts = 10000000) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const nonce = generateNonce();
      const valid = await verifyNonce(hashHex, nonce);
      if (valid) {
        return { nonce, found: true };
      }
      // Yield to event loop every 1000 attempts
      if (attempt % 1000 === 0) {
        await new Promise(r => setTimeout(r, 0));
      }
    }
    return { nonce: generateNonce(), found: false };
  }

  /**
   * Generate a random 4-byte (8 hex char) nonce.
   * @returns {string} 8-char hex string
   */
  function generateNonce() {
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    return bufToHex(bytes);
  }

  /**
   * Generate ntime value (current timestamp in hex, big-endian, 8 hex chars).
   * @returns {string} 8-char hex timestamp
   */
  function generateNtime() {
    const now = Math.floor(Date.now() / 1000);
    return (now >>> 0).toString(16).padStart(8, '0');
  }

  /**
   * Generate version value (default 0x20000000).
   * @returns {string} 8-char hex version
   */
  function generateVersion() {
    return '20000000';
  }

  /**
   * Hash image data (raw pixels) to produce SHA-256 fingerprint.
   * @param {Uint8ClampedArray|Uint8Array} imageData
   * @returns {Promise<string>} 64-char hex hash
   */
  async function hashImageData(imageData) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', imageData);
    return bufToHex(new Uint8Array(hashBuffer));
  }

  /**
   * Hash an image from a URL (fetches and hashes the raw bytes).
   * @param {string} url - image URL
   * @returns {Promise<string>} 64-char hex hash of raw file bytes
   */
  async function hashImageUrl(url) {
    const response = await fetch(url, { mode: 'no-cors', cache: 'no-cache' });
    const blob = await response.blob();
    const buf = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buf);
    return bufToHex(new Uint8Array(hashBuffer));
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  function bufToHex(buf) {
    return Array.from(buf)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  function hexToBuf(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
  }

  // ---------------------------------------------------------------------------
  // Exports
  // ---------------------------------------------------------------------------
  const CryptoUtil = {
    sha256,
    sha256Double,
    verifyNonce,
    findNonce,
    generateNonce,
    generateNtime,
    generateVersion,
    hashImageData,
    hashImageUrl,
    TARGET_DIFFICULTY,
    bufToHex,
    hexToBuf,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CryptoUtil;
  }
  global.CryptoUtil = CryptoUtil;
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
