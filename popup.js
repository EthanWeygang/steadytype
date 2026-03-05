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
  var apiKeyInput = document.getElementById("apiKeyInput");
  var apiSaveBtn  = document.getElementById("apiSaveBtn");
  var apiStatus   = document.getElementById("apiStatus");

  /* ── Load current state from storage ─────────────────────── */
  chrome.storage.sync.get(
    { steadyTypeEnabled: true, requestCount: 0, correctionCount: 0, geminiApiKey: "" },
    function (data) {
      toggle.checked     = data.steadyTypeEnabled;
      statusText.textContent = data.steadyTypeEnabled ? "Active" : "Paused";
      reqCount.textContent   = data.requestCount.toLocaleString();
      corrCount.textContent  = data.correctionCount.toLocaleString();

      if (data.geminiApiKey) {
        apiKeyInput.value = data.geminiApiKey;
        apiStatus.textContent = "\u2713 Key saved";
        apiStatus.className = "api-status has-key";
      } else {
        apiStatus.textContent = "No key set \u2014 enter your Gemini API key";
        apiStatus.className = "api-status no-key";
      }
    }
  );

  /* ── Toggle on/off ───────────────────────────────────────── */
  toggle.addEventListener("change", function () {
    var enabled = toggle.checked;
    statusText.textContent = enabled ? "Active" : "Paused";
    chrome.storage.sync.set({ steadyTypeEnabled: enabled });
  });

  /* ── Save API key ────────────────────────────────────────── */
  apiSaveBtn.addEventListener("click", function () {
    var key = apiKeyInput.value.trim();
    if (!key) {
      apiStatus.textContent = "Please enter a key";
      apiStatus.className = "api-status no-key";
      return;
    }
    chrome.storage.sync.set({ geminiApiKey: key }, function () {
      apiStatus.textContent = "\u2713 Key saved";
      apiStatus.className = "api-status has-key";
      apiSaveBtn.classList.add("saved");
      apiSaveBtn.textContent = "Saved!";
      setTimeout(function () {
        apiSaveBtn.classList.remove("saved");
        apiSaveBtn.textContent = "Save";
      }, 1500);
    });
  });

  apiKeyInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { apiSaveBtn.click(); }
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
