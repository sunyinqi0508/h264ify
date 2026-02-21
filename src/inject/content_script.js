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

// IMPORTANT (Manifest V3):
// - This script runs in an isolated world and *can* use chrome.* APIs.
// - The actual codec-spoofing overrides run in src/inject/inject.js, which is
//   registered as a MAIN-world content script via manifest.json.
//
// This file's job is to cache chrome.storage.local options into the page's
// localStorage so inject.js (which cannot access chrome.storage in MAIN world)
// can read options synchronously.

function setDefaultIfUndefined(key, value) {
  if (localStorage[key] === undefined) {
    localStorage[key] = value;
  }
}

function writeOptionsToLocalStorage(options) {
  // Persist as strings (localStorage only stores strings).
  localStorage['h264ify-enable'] = options.enable;
  localStorage['h264ify-block_60fps'] = options.block_60fps;
  localStorage['h264ify-battery_only'] = options.battery_only;
  // When true, allow VP9+H.264, but block AV1.
  localStorage['h264ify-av1_only'] = options.av1_only;
}

// Set defaults for options stored in localStorage.
// This makes inject.js behave deterministically at document_start.
setDefaultIfUndefined('h264ify-enable', true);
setDefaultIfUndefined('h264ify-block_60fps', false);
setDefaultIfUndefined('h264ify-battery_only', false);
setDefaultIfUndefined('h264ify-av1_only', false);

// Cache chrome.storage.local options in localStorage.
// This is needed because chrome.storage.local.get() is async.
// See https://bugs.chromium.org/p/chromium/issues/detail?id=54257
chrome.storage.local.get(
  {
    // Defaults
    enable: true,
    block_60fps: false,
    battery_only: false,
    av1_only: false
  },
  function (options) {
    writeOptionsToLocalStorage(options);
  }
);

// Keep localStorage in sync if the user changes options without reloading.
try {
  chrome.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName !== 'local' || !changes) return;

    var updated = {
      enable: changes.enable ? changes.enable.newValue : undefined,
      block_60fps: changes.block_60fps ? changes.block_60fps.newValue : undefined,
      battery_only: changes.battery_only ? changes.battery_only.newValue : undefined,
      av1_only: changes.av1_only ? changes.av1_only.newValue : undefined
    };

    // Only write keys that actually changed.
    if (updated.enable !== undefined) localStorage['h264ify-enable'] = updated.enable;
    if (updated.block_60fps !== undefined) localStorage['h264ify-block_60fps'] = updated.block_60fps;
    if (updated.battery_only !== undefined) localStorage['h264ify-battery_only'] = updated.battery_only;
    if (updated.av1_only !== undefined) localStorage['h264ify-av1_only'] = updated.av1_only;
  });
} catch (e) {
  // Ignore - some browsers may restrict listeners in certain contexts.
}
