/* ── SteadyType · Popup Script ──────────────────────────────────
 *  Controls the on/off toggle and displays request counters.
 * ─────────────────────────────────────────────────────────────── */

(function () {
  "use strict";

  var toggle      = document.getElementById("enableToggle");
  var statusText  = document.getElementById("statusText");
  var reqCount    = document.getElementById("requestCount");
  var corrCount   = document.getElementById("correctionCount");
  var resetBtn    = document.getElementById("resetBtn");

  /* ── Load current state from storage ─────────────────────── */
  chrome.storage.sync.get(
    { steadyTypeEnabled: true, requestCount: 0, correctionCount: 0 },
    function (data) {
      toggle.checked     = data.steadyTypeEnabled;
      statusText.textContent = data.steadyTypeEnabled ? "Active" : "Paused";
      reqCount.textContent   = data.requestCount.toLocaleString();
      corrCount.textContent  = data.correctionCount.toLocaleString();
    }
  );

  /* ── Toggle on/off ───────────────────────────────────────── */
  toggle.addEventListener("change", function () {
    var enabled = toggle.checked;
    statusText.textContent = enabled ? "Active" : "Paused";
    chrome.storage.sync.set({ steadyTypeEnabled: enabled });
  });

  /* ── Reset counters ──────────────────────────────────────── */
  resetBtn.addEventListener("click", function () {
    chrome.storage.sync.set({ requestCount: 0, correctionCount: 0 });
    reqCount.textContent  = "0";
    corrCount.textContent = "0";
  });

  /* ── Live-update while popup is open ─────────────────────── */
  chrome.storage.onChanged.addListener(function (changes) {
    if (changes.requestCount) {
      reqCount.textContent = (changes.requestCount.newValue || 0).toLocaleString();
    }
    if (changes.correctionCount) {
      corrCount.textContent = (changes.correctionCount.newValue || 0).toLocaleString();
    }
    if (changes.steadyTypeEnabled) {
      toggle.checked = changes.steadyTypeEnabled.newValue;
      statusText.textContent = changes.steadyTypeEnabled.newValue ? "Active" : "Paused";
    }
  });
})();
