/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2015 erkserkserks
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// IMPORTANT:
// This file is injected into the *page context* (not the extension's isolated
// content-script world). This ensures overrides take effect for YouTube's own
// JavaScript.

(function () {
  // Prevent double-injection in the same page/frame.
  // (YouTube is an SPA; this also avoids accidental double wrapping.)
  if (window.__h264ifyInjected) return;
  window.__h264ifyInjected = true;

  function lsBool(key, defaultValue) {
    try {
      var v = localStorage[key];
      if (v === undefined || v === null) return defaultValue;
      if (v === true || v === false) return v;
      if (v === 'true') return true;
      if (v === 'false') return false;
      // Fallback: treat any other string as truthy.
      return Boolean(v);
    } catch (e) {
      return defaultValue;
    }
  }

  function getDisallowedSubstrings() {
    // Default behaviour: prefer H.264 by disallowing WebM/VP8/VP9 (+ AV1).
    // Optional behaviour (set in the extension options): allow VP9 and H.264
    // but disallow AV1.
    if (lsBool('h264ify-av1_only', false)) {
      // Allow VP9/H.264 but disallow AV1.
      // Keep blocking VP8 (legacy codec) to avoid forcing the old/less
      // efficient codec.
      return ['vp8', 'vp08', 'av01', 'av1'];
    }
    // Note: VP9 may appear as "vp9" or "vp09" depending on container.
    return ['webm', 'vp8', 'vp08', 'vp9', 'vp09', 'av01', 'av1'];
  }

  function isDisallowedTypeString(typeLower) {
    if (!typeLower) return false;

    var disallowed = getDisallowedSubstrings();
    for (var i = 0; i < disallowed.length; i++) {
      if (typeLower.indexOf(disallowed[i]) !== -1) return true;
    }

    // Optional: block 60fps video.
    if (lsBool('h264ify-block_60fps', false)) {
      var match = /framerate=(\d+)/.exec(typeLower);
      if (match && match[1] && Number(match[1]) > 30) return true;
    }

    return false;
  }

  function isDisallowedDecodingConfig(config) {
    try {
      if (!config) return false;

      // MediaCapabilities config format:
      // { type: 'file', video: { contentType, width, height, bitrate, framerate }, ... }
      var video = config.video;
      if (!video) return false;

      var ct = video.contentType;
      if (ct && isDisallowedTypeString(String(ct).toLowerCase())) return true;

      if (lsBool('h264ify-block_60fps', false)) {
        if (typeof video.framerate === 'number' && video.framerate > 30) return true;
        // Some callers might encode framerate inside contentType.
        if (ct) {
          var match = /framerate=(\d+)/.exec(String(ct).toLowerCase());
          if (match && match[1] && Number(match[1]) > 30) return true;
        }
      }
    } catch (e) {
      // Fall through.
    }

    return false;
  }

  function makeModifiedTypeChecker(origChecker, blockedReturnValue) {
    return function (type) {
      if (!type) return blockedReturnValue;
      var typeLower = String(type).toLowerCase();
      if (isDisallowedTypeString(typeLower)) return blockedReturnValue;
      return origChecker(type);
    };
  }

  function overrideApis() {
    // Override video element canPlayType() function
    try {
      var videoElem = document.createElement('video');
      var origCanPlayType = videoElem.canPlayType.bind(videoElem);
      // canPlayType() returns a string: 'probably', 'maybe', or ''
      videoElem.__proto__.canPlayType = makeModifiedTypeChecker(origCanPlayType, '');
    } catch (e) {
      // Ignore.
    }

    // Override media source extension isTypeSupported() function
    try {
      var mse = window.MediaSource;
      // Check for MSE support before use
      if (mse !== undefined && mse && typeof mse.isTypeSupported === 'function') {
        var origIsTypeSupported = mse.isTypeSupported.bind(mse);
        // MediaSource.isTypeSupported() returns a boolean.
        // IMPORTANT: returning '' here can break sites that do strict checks
        // (e.g. `!== false`), so we must return a real boolean false.
        mse.isTypeSupported = makeModifiedTypeChecker(origIsTypeSupported, false);
      }
    } catch (e) {
      // Ignore.
    }

    // Newer YouTube builds may consult the MediaCapabilities API.
    // Spoof it in addition to canPlayType/isTypeSupported to robustly block
    // unwanted codecs.
    try {
      var mc = navigator.mediaCapabilities;
      if (mc && typeof mc.decodingInfo === 'function') {
        var origDecodingInfo = mc.decodingInfo.bind(mc);
        mc.decodingInfo = function (config) {
          // Fast-path: if we already know this config is disallowed, return an
          // "unsupported" response immediately.
          if (isDisallowedDecodingConfig(config)) {
            return Promise.resolve({
              supported: false,
              smooth: false,
              powerEfficient: false
            });
          }

          return origDecodingInfo(config).then(function (info) {
            if (!isDisallowedDecodingConfig(config)) return info;

            // Preserve any additional properties, but force support flags off.
            var clone = {};
            for (var k in info) clone[k] = info[k];
            clone.supported = false;
            clone.smooth = false;
            clone.powerEfficient = false;
            return clone;
          });
        };
      }
    } catch (e) {
      // Ignore.
    }
  }

  // Entry point
  function inject() {
    if (lsBool('h264ify-enable', true) === false) {
      return;
    }

    // Optional: only enforce when on battery.
    if (lsBool('h264ify-battery_only', false) === true && navigator.getBattery) {
      try {
        navigator.getBattery().then(function (battery) {
          if (battery && battery.charging === false) {
            overrideApis();
          }
        });
      } catch (e) {
        // Fall back to always-on if battery API fails.
        overrideApis();
      }
    } else {
      overrideApis();
    }
  }

  inject();
})();
