/* ── SteadyType · Content Script ────────────────────────────────
 *  1. Software debounce  – suppresses duplicate keystrokes < 80 ms apart
 *  2. Pause trigger      – captures the current word after 300 ms of idle
 *  3. Ghost text overlay  – shows AI-suggested correction inline
 *  4. Tab acceptance      – replaces the word when Tab is pressed
 * ──────────────────────────────────────────────────────────────── */

(function () {
  "use strict";

  console.log("[SteadyType CS] Content script initializing...");

  var steadyTypeEnabled = true;

  /* ── Listen for enable/disable changes from popup ──────────── */
  chrome.storage.onChanged.addListener(function (changes) {
    if (changes.steadyTypeEnabled) {
      steadyTypeEnabled = changes.steadyTypeEnabled.newValue;
      console.log("[SteadyType CS] Enabled:", steadyTypeEnabled);
    }
  });

  /* ── Load initial enabled state ────────────────────────────── */
  chrome.storage.sync.get({ steadyTypeEnabled: true }, function (data) {
    steadyTypeEnabled = data.steadyTypeEnabled;
    console.log("[SteadyType CS] Initial enabled state:", steadyTypeEnabled);
  });

  var DEBOUNCE_MS = 80;
  var PAUSE_MS = 1000;

  console.log("[SteadyType CS] DEBOUNCE_MS:", DEBOUNCE_MS, "PAUSE_MS:", PAUSE_MS);

  /* ════════════════════════════════════════════════════════════════
   *  Per-field state  (WeakMap keyed on the input/textarea element)
   * ════════════════════════════════════════════════════════════════ */
  var fieldState = new WeakMap();

  function getState(el) {
    if (!fieldState.has(el)) {
      fieldState.set(el, {
        lastKeyTime: 0,
        lastKeyChar: null,
        pauseTimer: null,
        ghost: null,
        indicator: null,
        pendingWord: null,
        suggestion: null,
        wordStart: -1
      });
    }
    return fieldState.get(el);
  }

  /* ════════════════════════════════════════════════════════════════
   *  Utility – extract the word the caret is currently inside
   * ════════════════════════════════════════════════════════════════ */
  function currentWord(el) {
    var text = el.value || el.textContent || "";
    var caret = (el.selectionStart != null) ? el.selectionStart : text.length;

    var start = caret;
    while (start > 0 && /\S/.test(text[start - 1])) { start--; }

    var end = caret;
    while (end < text.length && /\S/.test(text[end])) { end++; }

    return { word: text.slice(start, end), start: start, end: end };
  }

  /* ════════════════════════════════════════════════════════════════
   *  Utility – grab surrounding context (up to 200 chars each side)
   * ════════════════════════════════════════════════════════════════ */
  function surroundingContext(el) {
    var text = el.value || el.textContent || "";
    var caret = (el.selectionStart != null) ? el.selectionStart : text.length;
    var before = text.slice(Math.max(0, caret - 200), caret);
    var after = text.slice(caret, caret + 200);
    return (before + after).trim();
  }

  /* ════════════════════════════════════════════════════════════════
   *  Ghost Text – creation / positioning / removal
   * ════════════════════════════════════════════════════════════════ */

  function measureOffset(el, charIndex) {
    var mirror = document.createElement("span");
    mirror.style.cssText =
      "position:absolute;visibility:hidden;white-space:pre;" +
      "font:" + getComputedStyle(el).font + ";";
    var text = (el.value || el.textContent || "").slice(0, charIndex);
    mirror.textContent = text;
    document.body.appendChild(mirror);
    var width = mirror.getBoundingClientRect().width;
    mirror.remove();
    return width;
  }

  function positionGhost(el, state) {
    var ghost = state.ghost;
    if (!ghost) { return; }

    var rect = el.getBoundingClientRect();
    var styles = getComputedStyle(el);
    var padLeft = parseFloat(styles.paddingLeft) || 0;
    var padTop = parseFloat(styles.paddingTop) || 0;
    var borderL = parseFloat(styles.borderLeftWidth) || 0;
    var borderT = parseFloat(styles.borderTopWidth) || 0;

    var textOffset = measureOffset(el, state.wordStart);

    ghost.style.top = (rect.top + window.scrollY + borderT + padTop) + "px";
    ghost.style.left = (rect.left + window.scrollX + borderL + padLeft + textOffset) + "px";

    ghost.style.font = styles.font;
    ghost.style.lineHeight = styles.lineHeight;
  }

  function showGhost(el, state, text) {
    console.log("[SteadyType CS] showGhost:", text);
    removeGhost(state, false);

    var ghost = document.createElement("span");
    ghost.className = "steady-type-ghost";
    ghost.textContent = text;
    ghost.style.opacity = "0";
    document.body.appendChild(ghost);
    state.ghost = ghost;

    positionGhost(el, state);
    setIndicatorState(el, state, "suggestion");

    console.log("[SteadyType CS] Ghost element created, position:",
      ghost.style.top, ghost.style.left, "text:", ghost.textContent);

    requestAnimationFrame(function () {
      ghost.style.opacity = "1";
    });
  }

  function removeGhost(state, clearSuggestion) {
    if (state.ghost) {
      state.ghost.remove();
      state.ghost = null;
    }
    if (clearSuggestion !== false) {
      state.suggestion = null;
      // Reset indicator to active (idle) when suggestion is cleared
      if (state.indicator) {
        state.indicator.setAttribute("data-state", "active");
      }
    }
  }

  /* ════════════════════════════════════════════════════════════════
   *  Status Indicator – show / position / update / remove
   * ════════════════════════════════════════════════════════════════ */
  function createIndicator(el, state) {
    if (state.indicator) { return; }

    var wrap = document.createElement("div");
    wrap.className = "steady-type-indicator";
    wrap.setAttribute("data-state", "active");

    var dot = document.createElement("span");
    dot.className = "steady-type-indicator-dot";
    wrap.appendChild(dot);

    var label = document.createElement("span");
    label.className = "steady-type-indicator-label";
    label.textContent = "Tab ↵";
    wrap.appendChild(label);

    document.body.appendChild(wrap);
    state.indicator = wrap;
    positionIndicator(el, state);
  }

  function positionIndicator(el, state) {
    var ind = state.indicator;
    if (!ind) { return; }

    var rect = el.getBoundingClientRect();
    var styles = getComputedStyle(el);
    var borderR = parseFloat(styles.borderRightWidth) || 0;
    var borderT = parseFloat(styles.borderTopWidth) || 0;
    var padTop = parseFloat(styles.paddingTop) || 0;

    // Position at top-right corner of the field
    ind.style.top = (rect.top + window.scrollY + borderT + padTop + 2) + "px";
    ind.style.left = (rect.right + window.scrollX - borderR - 30) + "px";
  }

  function setIndicatorState(el, state, newState) {
    if (!state.indicator) { createIndicator(el, state); }
    state.indicator.setAttribute("data-state", newState);
    positionIndicator(el, state);
  }

  function removeIndicator(state) {
    if (state.indicator) {
      state.indicator.remove();
      state.indicator = null;
    }
  }

  /* ════════════════════════════════════════════════════════════════
   *  Software Debounce  (keydown phase)
   * ════════════════════════════════════════════════════════════════ */
  function shouldDebounce(e, state) {
    var now = performance.now();
    var isDuplicate =
      e.key === state.lastKeyChar && (now - state.lastKeyTime) < DEBOUNCE_MS;

    if (isDuplicate) {
      console.log("[SteadyType CS] Debouncing duplicate key:", e.key);
    }

    state.lastKeyTime = now;
    state.lastKeyChar = e.key;

    return isDuplicate;
  }

  /* ════════════════════════════════════════════════════════════════
   *  Pause Trigger
   * ════════════════════════════════════════════════════════════════ */
  function resetPauseTimer(el, state) {
    clearTimeout(state.pauseTimer);
    state.pauseTimer = setTimeout(function () {
      onPause(el, state);
    }, PAUSE_MS);
  }

  function onPause(el, state) {
    var info = currentWord(el);
    var word = info.word;
    var start = info.start;

    console.log("[SteadyType CS] Pause trigger fired - word:", word);

    if (!word || word.length < 2) {
      console.log("[SteadyType CS] Word too short, ignoring");
      return;
    }

    if (word === state.pendingWord) {
      console.log("[SteadyType CS] Already pending this word, skipping");
      return;
    }

    state.pendingWord = word;
    state.wordStart = start;

    setIndicatorState(el, state, "processing");

    var context = surroundingContext(el);
    console.log("[SteadyType CS] Sending to background:", { word: word, contextLen: context.length });

    chrome.runtime.sendMessage(
      {
        type: "STEADYTYPE_CORRECT",
        word: word,
        context: context
      },
      function (response) {
        console.log("[SteadyType CS] Response from background:", response);

        if (chrome.runtime.lastError) {
          console.error("[SteadyType CS] Message error:", chrome.runtime.lastError.message);
          return;
        }

        // Check current word — allow if it starts with same letters (user kept typing)
        var cur = currentWord(el);
        console.log("[SteadyType CS] Current word now:", cur.word, "original:", word);

        if (response && response.corrected) {
          console.log("[SteadyType CS] Got correction:", response.corrected);
          state.suggestion = response.corrected;
          state.wordStart = cur.start;
          showGhost(el, state, response.corrected);
        } else {
          console.log("[SteadyType CS] No correction suggested");
          setIndicatorState(el, state, "active");
        }
      }
    );
  }

  /* ════════════════════════════════════════════════════════════════
   *  Tab Acceptance
   * ════════════════════════════════════════════════════════════════ */
  function acceptSuggestion(el, state) {
    var info = currentWord(el);
    var suggestion = state.suggestion;
    if (!suggestion) { return; }

    console.log("[SteadyType CS] Accepting suggestion:", suggestion);

    el.focus();
    el.setSelectionRange(info.start, info.end);
    document.execCommand("insertText", false, suggestion);

    removeGhost(state, true);
    state.pendingWord = null;
    setIndicatorState(el, state, "active");
  }

  /* ════════════════════════════════════════════════════════════════
   *  Event Handlers
   * ════════════════════════════════════════════════════════════════ */
  function onKeyDown(e) {
    var el = e.target;
    var state = getState(el);

    console.log("[SteadyType CS] keydown:", e.key, el.tagName);

    // Tab acceptance
    if (e.key === "Tab" && state.suggestion) {
      console.log("[SteadyType CS] Tab → accepting:", state.suggestion);
      e.preventDefault();
      acceptSuggestion(el, state);
      return;
    }

    // Software debounce
    if (e.key.length === 1 && shouldDebounce(e, state)) {
      e.preventDefault();
      return;
    }

    // Clear ghost on regular typing but keep suggestion until new one arrives
    if (e.key.length === 1) {
      removeGhost(state, false);
    }
  }

  function onInput(e) {
    var el = e.target;
    var state = getState(el);

    console.log("[SteadyType CS] input event on", el.tagName);

    // Reposition ghost if still showing
    if (state.ghost) {
      var info = currentWord(el);
      if (
        state.suggestion &&
        state.suggestion.toLowerCase().indexOf(info.word.toLowerCase()) === 0 &&
        info.word.length < state.suggestion.length
      ) {
        state.wordStart = info.start;
        showGhost(el, state, state.suggestion);
      } else {
        removeGhost(state);
      }
    }

    // Restart inactivity timer
    resetPauseTimer(el, state);
  }

  /* ── Keep ghost positioned on scroll / resize ──────────────── */
  function onPositionChange(e) {
    var el = (e.target && e.target.nodeType === 1) ? e.target : document.activeElement;
    if (!el || !fieldState.has(el)) { return; }
    var state = getState(el);
    if (state.ghost) { positionGhost(el, state); }
    if (state.indicator) { positionIndicator(el, state); }
  }

  /* ════════════════════════════════════════════════════════════════
   *  Text field detection
   * ════════════════════════════════════════════════════════════════ */
  function isTextField(el) {
    if (!el || el.nodeType !== 1) { return false; }
    var tag = el.tagName;
    if (tag === "TEXTAREA") { return true; }
    if (tag === "INPUT") {
      var type = (el.type || "text").toLowerCase();
      return ["text", "search", "url", "email", "tel", "password"].indexOf(type) !== -1;
    }
    return el.isContentEditable;
  }

  /* ════════════════════════════════════════════════════════════════
   *  Attach listeners (delegation at document level)
   * ════════════════════════════════════════════════════════════════ */
  console.log("[SteadyType CS] Attaching event listeners...");

  document.addEventListener("keydown", function (e) {
    if (steadyTypeEnabled && isTextField(e.target)) { onKeyDown(e); }
  }, true);
  console.log("[SteadyType CS] keydown listener attached");

  document.addEventListener("input", function (e) {
    if (steadyTypeEnabled && isTextField(e.target)) { onInput(e); }
  }, true);
  console.log("[SteadyType CS] input listener attached");

  document.addEventListener("scroll", onPositionChange, true);
  window.addEventListener("resize", onPositionChange);
  console.log("[SteadyType CS] scroll & resize listeners attached");

  document.addEventListener("focusin", function (e) {
    if (isTextField(e.target)) {
      var state = getState(e.target);
      createIndicator(e.target, state);
    }
  }, true);
  console.log("[SteadyType CS] focusin listener attached");

  document.addEventListener("focusout", function (e) {
    if (isTextField(e.target) && fieldState.has(e.target)) {
      var state = getState(e.target);
      clearTimeout(state.pauseTimer);
      removeGhost(state);
      removeIndicator(state);
    }
  }, true);
  console.log("[SteadyType CS] focusout listener attached");

  console.log("[SteadyType CS] Content script fully initialized!");
})();
