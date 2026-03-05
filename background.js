/* ── SteadyType · Background Service Worker ────────────────────
 *  Listens for correction requests from the content script,
 *  calls Gemini 2.0 Flash API, and returns the corrected word.
 * ─────────────────────────────────────────────────────────────── */

console.log("[SteadyType BG] Service worker loaded");

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/" +
  GEMINI_MODEL +
  ":generateContent";

console.log("[SteadyType BG] Gemini URL:", GEMINI_URL);

const SYSTEM_INSTRUCTION =
  "The user has Parkinson's and experiences tremors. " +
  "They hit nearby keys unintentionally (e.g., 'gks' instead of 'has'). " +
  "Analyze the input text and the surrounding context of the page to return " +
  "only the corrected word. Do not explain the correction.";

/* ── Exponential back-off helper (Google best practices) ─────── */
async function fetchWithBackoff(url, options, maxRetries = 5) {
  let delay = 500;
  console.log("[SteadyType BG] fetchWithBackoff starting");

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      console.log("[SteadyType BG] API attempt " + (attempt + 1) + "/" + (maxRetries + 1));
      const response = await fetch(url, options);

      if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
        console.warn("[SteadyType BG] Got status " + response.status + ", retrying...");
        const jitter = Math.random() * delay * 0.5;
        await new Promise(function (r) { setTimeout(r, delay + jitter); });
        delay *= 2;
        continue;
      }

      console.log("[SteadyType BG] API response status:", response.status);
      return response;
    } catch (err) {
      console.error("[SteadyType BG] Network error attempt " + (attempt + 1) + ":", err.message);
      if (attempt < maxRetries) {
        const jitter = Math.random() * delay * 0.5;
        await new Promise(function (r) { setTimeout(r, delay + jitter); });
        delay *= 2;
        continue;
      }
      throw err;
    }
  }
}

/* ── Set API key on install (replace with your own key) ──────── */
// To set your API key, run this in the browser console (or use an options page):
//   chrome.storage.sync.set({ geminiApiKey: "YOUR_KEY_HERE" });

/* ── Retrieve the API key from extension storage ─────────────── */
async function getApiKey() {
  return new Promise(function (resolve, reject) {
    chrome.storage.sync.get("geminiApiKey", function (data) {
      if (chrome.runtime.lastError) {
        console.error("[SteadyType BG] Storage error:", chrome.runtime.lastError);
        return reject(chrome.runtime.lastError);
      }
      if (!data.geminiApiKey) {
        console.error("[SteadyType BG] No API key found in storage");
        return reject(new Error("Gemini API key not set."));
      }
      console.log("[SteadyType BG] API key retrieved OK");
      resolve(data.geminiApiKey);
    });
  });
}

/* ── Call Gemini 2.0 Flash ───────────────────────────────────── */
async function correctWord(word, surroundingContext) {
  console.log("[SteadyType BG] correctWord called:", word);
  var apiKey = await getApiKey();
  var url = GEMINI_URL + "?key=" + apiKey;

  var userPrompt =
    'Surrounding context: "' + surroundingContext + '"\n' +
    'Word to correct: "' + word + '"\n' +
    "Return ONLY the corrected word, nothing else.";

  var body = {
    system_instruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }]
    },
    contents: [
      {
        role: "user",
        parts: [{ text: userPrompt }]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 30
    }
  };

  var response = await fetchWithBackoff(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    var errText = await response.text();
    console.error("[SteadyType BG] API error " + response.status + ":", errText);
    throw new Error("Gemini API error " + response.status + ": " + errText);
  }

  var json = await response.json();
  console.log("[SteadyType BG] API response JSON:", JSON.stringify(json));

  var corrected = "";
  if (
    json.candidates &&
    json.candidates[0] &&
    json.candidates[0].content &&
    json.candidates[0].content.parts &&
    json.candidates[0].content.parts[0]
  ) {
    corrected = json.candidates[0].content.parts[0].text.trim();
  }

  console.log("[SteadyType BG] Corrected word:", corrected);
  return corrected;
}

/* ── Message listener ────────────────────────────────────────── */
console.log("[SteadyType BG] Registering message listener");

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  console.log("[SteadyType BG] Message received:", message.type);

  if (message.type !== "STEADYTYPE_CORRECT") {
    console.log("[SteadyType BG] Ignoring message (wrong type)");
    return false;
  }

  var word = message.word;
  var context = message.context;
  console.log("[SteadyType BG] Processing correction for:", word);

  correctWord(word, context)
    .then(function (corrected) {
      console.log("[SteadyType BG] Correction done:", { original: word, corrected: corrected });
      if (corrected && corrected.toLowerCase() !== word.toLowerCase()) {
        console.log("[SteadyType BG] Sending suggestion:", corrected);
        sendResponse({ corrected: corrected });
      } else {
        console.log("[SteadyType BG] No change needed");
        sendResponse({ corrected: null });
      }
    })
    .catch(function (err) {
      console.error("[SteadyType BG] Correction error:", err);
      sendResponse({ corrected: null, error: err.message });
    });

  return true;
});

console.log("[SteadyType BG] Background script fully loaded");
