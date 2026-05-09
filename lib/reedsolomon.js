/**
 * Reed-Solomon error correction over GF(2^8) with primitive polynomial 0x11d
 *
 * Field: GF(2^8), primitive poly = 0x11d, alpha = 2
 * Polynomial convention: index i = coefficient of x^i (ascending order)
 * Systematic codeword format: [ECC bytes (nsym)] + [data bytes]
 *
 * Generator: Product of (alpha^i + x) for i = 0..nsym-1
 *   Factor [GF_EXP[i], 1] = alpha^i + x^1 (ascending coefficients)
 *
 * Exports:
 *   rsEncodeMsg(data, nsym) -> Uint8Array  ([ecc | data] systematic codeword)
 *   rsDecodeMsg(data, nsym) -> Uint8Array | null  (corrected data, or null)
 *   rsSyndromes(msg, nsym) -> Uint8Array
 */

(function (global) {
  'use strict';

  // ---------------------------------------------------------------------------
  // GF(2^8) tables
  // ---------------------------------------------------------------------------
  const GF_EXP = new Uint16Array(512);
  const GF_LOG = new Uint8Array(256);
  const PRIMITIVE_POLY = 0x11d; // x^8 + x^4 + x^3 + x^2 + 1

  (function initTables() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      GF_EXP[i] = x;
      GF_EXP[i + 255] = x; // double for convenience
      GF_LOG[x] = i;
      x <<= 1;
      if (x & 0x100) {
        x ^= PRIMITIVE_POLY;
      }
    }
    GF_EXP[510] = GF_EXP[0];
    GF_EXP[511] = GF_EXP[1];
  })();

  // ---------------------------------------------------------------------------
  // GF(2^8) Arithmetic
  // ---------------------------------------------------------------------------

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
  }

  function gfDiv(a, b) {
    if (b === 0) throw new Error('Division by zero in GF');
    if (a === 0) return 0;
    return GF_EXP[(GF_LOG[a] + 255 - GF_LOG[b]) % 255];
  }

  // ---------------------------------------------------------------------------
  // Polynomial Operations (ascending order: poly[i] = coeff of x^i)
  // ---------------------------------------------------------------------------

  function gfPolyMul(a, b) {
    const result = new Uint8Array(a.length + b.length - 1);
    for (let j = 0; j < b.length; j++) {
      for (let i = 0; i < a.length; i++) {
        result[i + j] ^= gfMul(a[i], b[j]);
      }
    }
    return result;
  }

  /**
   * Evaluate polynomial in ASCENDING order.
   * poly[i] = coefficient of x^i
   * result = poly[0] + poly[1]*x + poly[2]*x^2 + ...
   */
  function gfPolyEvalAsc(poly, x) {
    let result = 0;
    let power = 1;
    for (let i = 0; i < poly.length; i++) {
      const coeff = poly[i];
      if (coeff !== 0 && power !== 0) {
        result ^= gfMul(coeff, power);
      }
      power = gfMul(power, x);
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Generator polynomial
  // ---------------------------------------------------------------------------

  /**
   * Generate monic Reed-Solomon generator polynomial.
   * g(x) = Product_{i=0}^{nsym-1} (alpha^i + x)
   * Factor [GF_EXP[i], 1] represents alpha^i + x^1 (ascending order)
   */
  function rsGeneratorPoly(nsym) {
    let g = new Uint8Array([1]);
    for (let i = 0; i < nsym; i++) {
      g = gfPolyMul(g, new Uint8Array([GF_EXP[i], 1]));
    }
    return g;
  }

  // ---------------------------------------------------------------------------
  // Encoding
  // ---------------------------------------------------------------------------

  /**
   * Reed-Solomon systematic encode.
   * Returns [ECC bytes] + [data bytes] (remainder prepended to data).
   * @param {Uint8Array} data - Input data bytes
   * @param {number} nsym - Number of error correction symbols
   * @returns {Uint8Array} - Systematic codeword [ecc | data]
   */
  function rsEncodeMsg(data, nsym) {
    if (nsym <= 0) throw new Error('nsym must be > 0');
    const gen = rsGeneratorPoly(nsym);
    const dividend = new Uint8Array(nsym + data.length);
    // Place data at the HIGH end: dividend[nsym..end] = data
    for (let i = 0; i < data.length; i++) {
      dividend[nsym + i] = data[i];
    }
    // Polynomial long division: work from high to low
    for (let i = dividend.length - 1; i >= nsym; i--) {
      const coef = dividend[i];
      if (coef !== 0) {
        for (let j = 0; j < gen.length; j++) {
          if (gen[j] !== 0) {
            dividend[i - nsym + j] ^= gfMul(gen[j], coef);
          }
        }
      }
    }
    // Remainder is the first nsym bytes; prepend to original data
    const result = new Uint8Array(nsym + data.length);
    result.set(dividend.subarray(0, nsym), 0);
    result.set(data, nsym);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Syndromes
  // ---------------------------------------------------------------------------

  /**
   * Compute syndromes for a received codeword.
   * S_i = r(alpha^i) for i = 0..nsym-1
   * Uses ascending-order polynomial evaluation.
   */
  function rsSyndromes(msg, nsym) {
    const syn = new Uint8Array(nsym);
    for (let i = 0; i < nsym; i++) {
      syn[i] = gfPolyEvalAsc(msg, GF_EXP[i]);
    }
    return syn;
  }

  // ---------------------------------------------------------------------------
  // Berlekamp-Massey
  // ---------------------------------------------------------------------------

  function rsBerlekampMassey(syn, nsym) {
    let C = new Uint8Array(nsym + 1);
    let B = new Uint8Array(nsym + 1);
    C[0] = 1;
    B[0] = 1;
    let L = 0;
    let m = 1;
    let b = 1;

    for (let n = 0; n < nsym; n++) {
      let d = syn[n];
      for (let i = 1; i <= L; i++) {
        d ^= gfMul(C[i], syn[n - i]);
      }
      if (d === 0) {
        m++;
      } else if (2 * L <= n) {
        const T = C.slice();
        const scale = gfMul(d, gfDiv(1, b));
        for (let i = 0; i <= nsym - m; i++) {
          if (B[i] !== 0) {
            T[i + m] ^= gfMul(scale, B[i]);
          }
        }
        L = n + 1 - L;
        B = C.slice();
        b = d;
        C = T.slice();
        m = 1;
      } else {
        const scale = gfMul(d, gfDiv(1, b));
        for (let i = 0; i <= nsym - m; i++) {
          if (B[i] !== 0) {
            C[i + m] ^= gfMul(scale, B[i]);
          }
        }
        m++;
      }
    }

    return C.slice(0, L + 1);
  }

  // ---------------------------------------------------------------------------
  // Chien search: find error positions
  // ---------------------------------------------------------------------------

  /**
   * Chien search evaluates error locator at alpha^{-i} for each position i.
   * @param {Uint8Array} errLoc - Error locator polynomial (ascending)
   * @param {number} nmess - Length of codeword
   * @returns {number[] | null} - Error positions (0-indexed) or null
   */
  function rsFindErrors(errLoc, nmess) {
    const errors = [];
    for (let i = 0; i < nmess; i++) {
      const x = GF_EXP[255 - i]; // alpha^{-i}
      if (gfPolyEvalAsc(errLoc, x) === 0) {
        errors.push(i); // Position i (not reversed)
      }
    }
    if (errors.length !== errLoc.length - 1) {
      return null;
    }
    return errors;
  }

  // ---------------------------------------------------------------------------
  // Decode
  // ---------------------------------------------------------------------------

  /**
   * Full Reed-Solomon decode with error correction.
   * @param {Uint8Array} msgIn - Received codeword [ecc | data]
   * @param {number} nsym - Number of error correction symbols
   * @returns {Uint8Array | null} - Corrected data (ECC removed) or null
   */
  function rsDecodeMsg(msgIn, nsym) {
    if (nsym <= 0) throw new Error('nsym must be > 0');
    if (msgIn.length <= nsym) return null;

    const msg = new Uint8Array(msgIn);

    // Compute syndromes
    const synd = rsSyndromes(msg, nsym);

    // Check if all syndromes are zero (no errors)
    let allZero = true;
    for (let i = 0; i < synd.length; i++) {
      if (synd[i] !== 0) {
        allZero = false;
        break;
      }
    }
    if (allZero) {
      return msg.slice(nsym);
    }

    // Berlekamp-Massey
    const errLoc = rsBerlekampMassey(synd, nsym);

    // Find error positions
    const errPos = rsFindErrors(errLoc, msg.length);
    if (errPos === null) return null;

    // Forney: compute error evaluator
    const nsymVal = nsym;
    const errEval = new Uint8Array(nsymVal);
    for (let i = 0; i < nsymVal; i++) {
      for (let j = 0; j <= Math.min(i, errLoc.length - 1); j++) {
        errEval[i] ^= gfMul(synd[i - j], errLoc[j]);
      }
    }

    // Formal derivative of error locator (odd terms only in char 2)
    const errLocDeriv = new Uint8Array(errLoc.length - 1);
    for (let i = 0; i < errLocDeriv.length; i += 2) {
      if (i + 1 < errLoc.length) {
        errLocDeriv[i] = errLoc[i + 1];
      }
    }

    // Correct errors
    const corrected = new Uint8Array(msg);
    for (let idx = 0; idx < errPos.length; idx++) {
      const pos = errPos[idx];
      const Xi = GF_EXP[pos % 255];
      const XiInv = gfDiv(1, Xi);
      const numer = gfPolyEvalAsc(errEval, XiInv);
      const denom = gfPolyEvalAsc(errLocDeriv, XiInv);
      if (denom === 0) continue;
      const magnitude = gfMul(Xi, gfDiv(numer, denom));
      corrected[pos] ^= magnitude;
    }

    // Verify corrected syndromes are zero
    const synd2 = rsSyndromes(corrected, nsym);
    for (let i = 0; i < synd2.length; i++) {
      if (synd2[i] !== 0) return null;
    }

    return corrected.slice(nsym);
  }

  // ---------------------------------------------------------------------------
  // Exports
  // ---------------------------------------------------------------------------
  const ReedSolomon = {
    rsEncodeMsg,
    rsDecodeMsg,
    rsSyndromes,
    // internal helpers (useful for testing/debugging)
    _gfMul: gfMul,
    _gfDiv: gfDiv,
    _gfPolyMul: gfPolyMul,
    _gfPolyEvalAsc: gfPolyEvalAsc,
    _rsGeneratorPoly: rsGeneratorPoly,
    _rsBerlekampMassey: rsBerlekampMassey,
    _rsFindErrors: rsFindErrors,
    _GF_EXP: GF_EXP,
    _GF_LOG: GF_LOG,
  };

  // Universal module definition
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ReedSolomon;
  }
  global.ReedSolomon = ReedSolomon;
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
