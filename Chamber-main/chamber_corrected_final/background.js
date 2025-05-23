// background.js

// Constants for message actions
const ACTION_PROCESS_REWRITE = "processRewrite";
const ACTION_SUMMARIZE_TEXT = "summarizeText";

// Placeholder for API Key - REPLACE WITH SECURE METHOD (e.g., user input and chrome.storage)
const DEEPSEEK_API_KEY = "sk-30252b2145d44f7aae00c42d28a8341a"; // WARNING: This API key is publicly visible.
const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_CHAT_MODEL = "deepseek-chat"; // Default model for rewriting (more capable)
const DEFAULT_REASONER_MODEL = "deepseek-reasoner"; // Cheaper model for summarization and simplified rewrites

// Approximate safe limits for the text content being sent to the AI,
// before it's wrapped in the prompt instructions.
// These values may need tuning based on typical prompt overhead and model context windows.
const MAX_INPUT_TEXT_CHARS_REASONER = 4000; // For deepseek-reasoner
const MAX_INPUT_TEXT_CHARS_CHAT = 6000;     // For deepseek-chat

// Listener for messages from popup.js or content.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === ACTION_PROCESS_REWRITE) {
    getRewrittenText(request.text, request.perspective, request.simplified, request.maxChars)
      .then(rewrittenText => {
        sendResponse({ rewrittenText });
      })
      .catch(err => {
        console.error("Chamber (Background) - API Error (Rewrite):", err);
        sendResponse({ rewrittenText: null, error: err.message || "Unknown API error during rewrite" });
      });
    return true; // Indicates that sendResponse will be called asynchronously
  } else if (request.action === ACTION_SUMMARIZE_TEXT) {
    summarizeText(request.text, request.perspective, request.simplified, request.maxSummaryChars)
      .then(summarizedText => {
        sendResponse({ summarizedText });
      })
      .catch(err => {
        console.error("Chamber (Background) - API Error (Summarize):", err);
        sendResponse({ summarizedText: null, error: err.message || "Unknown API error during summarization" });
      });
    return true; // Indicates that sendResponse will be called asynchronously
  }
});

/**
 * Generates a cache key for storing/retrieving results from chrome.storage.local.
 * @param {string} operation - Type of operation (e.g., "rewrite", "summarize").
 * @param {string} text - The input text.
 * @param {string} perspective - The perspective.
 * @param {boolean} simplified - Whether simplified language is requested.
 * @param {string} model - The AI model used.
 * @param {number} maxOutputChars - The target max characters for the output.
 * @returns {string} A cache key string.
 */
function generateCacheKey(operation, text, perspective, simplified, model, maxOutputChars) {
  // For very long text, consider hashing, but for now, direct use up to a limit.
  const textSnippet = text.substring(0, 200); // Use a snippet to keep key length reasonable
  return `chamber_${operation}_${textSnippet}_${perspective}_${simplified}_${model}_${maxOutputChars}`;
}

/**
 * Creates a prompt for summarizing text.
 * @param {string} text - The text to summarize.
 * @param {number} maxChars - The target maximum character length for the summary.
 * @returns {string} The summarization prompt.
 */
function createSummarizePrompt(text, maxChars) {
  return `Summarize the following text concisely, aiming for a maximum of ${maxChars} characters. Focus on the key points and main arguments. Do not add any opinions or interpretations not present in the original text. Avoid using Markdown formatting.

Text to summarize:
"${text}"`;
}

/**
 * Calls the DeepSeek API to get summarized text.
 * @param {string} text - The original text to summarize.
 * @param {string} perspective - The chosen ideological perspective (used for context, though summarization should be neutral).
 * @param {boolean} simplified - Whether to simplify the language (used for context).
 * @param {number} maxSummaryChars - The target maximum character length for the summary.
 * @returns {Promise<string>} - A promise that resolves with the summarized text.
 */
async function summarizeText(text, perspective, simplified, maxSummaryChars = 800) {
  const operationType = "summarize";
  const modelForSummary = DEFAULT_REASONER_MODEL;
  const cacheKey = generateCacheKey(operationType, text, perspective, simplified, modelForSummary, maxSummaryChars);

  return new Promise((resolve, reject) => {
    chrome.storage.local.get([cacheKey], async (cachedResult) => {
      if (chrome.runtime.lastError) {
        console.error("Chamber (Background) - Error getting summary from cache:", chrome.runtime.lastError);
        // Proceed to fetch from API, do not reject yet
      } else if (cachedResult[cacheKey] && cachedResult[cacheKey].summarizedText) {
        console.log("Chamber (Background) - Serving summary from cache:", cacheKey);
        resolve(cachedResult[cacheKey].summarizedText);
        return;
      }

      // If not in cache or cache read error, proceed with API call
      try {
        let processedText = text; // Use a new variable for text processing within this scope
        if (processedText.length > MAX_INPUT_TEXT_CHARS_REASONER) {
          console.warn(`Chamber (Background) - Trimming input text for summarization from ${processedText.length} to ${MAX_INPUT_TEXT_CHARS_REASONER} chars.`);
          processedText = processedText.substring(0, MAX_INPUT_TEXT_CHARS_REASONER);
        }
        // Generate cache key again with potentially trimmed text for prompt, though original text key was used for lookup
        const prompt = createSummarizePrompt(processedText, maxSummaryChars);
        const estimatedTokens = Math.ceil(maxSummaryChars / 3.5);
        const maxTokensForAPI = Math.min(800, Math.max(100, estimatedTokens));

        console.log(`Summarizing (API): "${processedText.substring(0, 100)}..." | Max Summary Chars: ${maxSummaryChars} | API Max Tokens: ${maxTokensForAPI}`);

        const requestBody = {
          model: modelForSummary,
          messages: [{ role: "user", content: prompt }],
          max_tokens: maxTokensForAPI,
          temperature: 0.5,
        };

        const response = await fetch(DEEPSEEK_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorText = await response.text();
          let errorMessage = `HTTP ${response.status}: ${errorText}`;
          try {
            const errorJson = JSON.parse(errorText);
            if (errorJson.error && errorJson.error.message) {
              errorMessage = `API Error (${response.status}): ${errorJson.error.message}`;
            }
          } catch (e) { /* Not JSON */ }
          throw new Error(errorMessage);
        }

        const data = await response.json();

        if (data.choices && data.choices.length > 0 && data.choices[0].message) {
          const summarizedTextOutput = data.choices[0].message.content.trim();
          const dataToCache = { summarizedText: summarizedTextOutput, timestamp: new Date().toISOString() };
          chrome.storage.local.set({ [cacheKey]: dataToCache }, () => {
            if (chrome.runtime.lastError) {
              console.error("Chamber (Background) - Error setting summary to cache:", chrome.runtime.lastError);
            } else {
              console.log("Chamber (Background) - Summary result cached:", cacheKey);
            }
          });
          resolve(summarizedTextOutput);
        } else {
          throw new Error("Failed to get valid response from AI for summarization.");
        }
      } catch (error) {
        console.error("Chamber (Background) - Error during API call/processing for summary:", error);
        reject(error); // Reject the promise with the actual error
      }
    });
  });
}

/**
 * Calls the DeepSeek API to get rewritten text.
 * @param {string} text - The original text to rewrite.
 * @param {string} perspective - The chosen ideological perspective.
 * @param {boolean} simplified - Whether to simplify the language.
 * @param {number} maxChars - The estimated maximum character length desired for the output.
 * @returns {Promise<string>} - A promise that resolves with the rewritten text.
 */
async function getRewrittenText(text, perspective, simplified, maxChars) {
  let modelToUse = DEFAULT_CHAT_MODEL;
  if (simplified) {
    modelToUse = DEFAULT_REASONER_MODEL;
  }
  const operationType = "rewrite";
  const cacheKey = generateCacheKey(operationType, text, perspective, simplified, modelToUse, maxChars);

  return new Promise((resolve, reject) => {
    chrome.storage.local.get([cacheKey], async (cachedResult) => {
      if (chrome.runtime.lastError) {
        console.error("Chamber (Background) - Error getting rewrite from cache:", chrome.runtime.lastError);
        // Proceed to fetch from API
      } else if (cachedResult[cacheKey] && cachedResult[cacheKey].rewrittenText) {
        console.log("Chamber (Background) - Serving rewrite from cache:", cacheKey);
        resolve(cachedResult[cacheKey].rewrittenText);
        return;
      }

      // If not in cache or cache read error, proceed with API call
      try {
        let processedText = text; // Use a new variable for text processing
        if (simplified && modelToUse === DEFAULT_REASONER_MODEL) {
            // console.log("Chamber (Background) - Using Reasoner model for simplified rewrite (already set).");
        } else if (!simplified && modelToUse === DEFAULT_CHAT_MODEL) {
            // console.log("Chamber (Background) - Using Chat model for standard rewrite (already set).");
        }


        let currentMaxInputChars = modelToUse === DEFAULT_CHAT_MODEL ? MAX_INPUT_TEXT_CHARS_CHAT : MAX_INPUT_TEXT_CHARS_REASONER;
        if (processedText.length > currentMaxInputChars) {
          console.warn(`Chamber (Background) - Trimming input text for rewrite from ${processedText.length} to ${currentMaxInputChars} chars (Model: ${modelToUse}).`);
          processedText = processedText.substring(0, currentMaxInputChars);
        }

        const prompt = createPrompt(processedText, perspective, simplified, maxChars);
        const estimatedTokens = Math.ceil(maxChars / 3.5);
        const maxTokensForAPI = Math.min(1500, Math.max(100, estimatedTokens));

        console.log(`Rewriting with ${modelToUse} (API): "${processedText.substring(0, 50)}..." | Max Chars: ${maxChars} | API Max Tokens: ${maxTokensForAPI}`);

        const requestBody = {
          model: modelToUse,
          messages: [{ role: "user", content: prompt }],
          max_tokens: maxTokensForAPI,
          temperature: 0.7,
        };

        const response = await fetch(DEEPSEEK_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorText = await response.text();
          let errorMessage = `HTTP ${response.status}: ${errorText}`;
          try {
            const errorJson = JSON.parse(errorText);
            if (errorJson.error && errorJson.error.message) {
              errorMessage = `API Error (${response.status}): ${errorJson.error.message}`;
            }
          } catch (e) { /* Not JSON */ }
          throw new Error(errorMessage);
        }

        const data = await response.json();

        if (data.choices && data.choices.length > 0 && data.choices[0].message) {
          const rewrittenTextOutput = data.choices[0].message.content.trim();
          const dataToCache = { rewrittenText: rewrittenTextOutput, timestamp: new Date().toISOString() };
          chrome.storage.local.set({ [cacheKey]: dataToCache }, () => {
            if (chrome.runtime.lastError) {
                console.error("Chamber (Background) - Error setting rewrite to cache:", chrome.runtime.lastError);
            } else {
                console.log("Chamber (Background) - Rewrite result cached:", cacheKey);
            }
          });
          resolve(rewrittenTextOutput);
        } else {
          throw new Error("Failed to get valid response from AI for rewrite.");
        }
      } catch (error) {
        console.error("Chamber (Background) - Error during API call/processing for rewrite:", error);
        reject(error); // Reject the promise with the actual error
      }
    });
  });
}

/**
 * Constructs the prompt string for the AI model.
 * @param {string} text - The original text.
 * @param {string} perspective - The chosen perspective.
 * @param {boolean} simplified - Whether to simplify.
 * @param {number} maxChars - The target character length.
 * @returns {string} The formatted prompt.
 */
function createPrompt(text, perspective, simplified, maxChars) {
  const perspectivesMap = {
    "liberal": "Rewrite from a liberal perspective emphasizing progressive values and social justice.",
    "conservative": "Rewrite from a conservative perspective emphasizing traditional values and patriotism.",
    "radical black left": "Rewrite from a radical Black left perspective highlighting racial justice and systemic resistance.",
    "neoliberal": "Rewrite from a neoliberal perspective highlighting market-based solutions and economic efficiency.",
    "techno-utopian": "Rewrite from a techno-utopian perspective focusing on innovation and optimism.",
    "socialist": "Rewrite from a socialist perspective promoting collective ownership and class consciousness.",
    "christian nationalist": "Rewrite from a Christian nationalist view emphasizing religious and national values.",
    "zionist": "Rewrite from a Zionist stance supporting Jewish homeland and sovereignty.",
    "anti-zionist": "Rewrite from an anti-Zionist stance emphasizing Palestinian liberation and anti-colonial critique.",
    "accelerationist": "Rewrite from an accelerationist lens pushing rapid transformation through disruption.",
    "anarchist": "Rewrite from an anarchist view opposing hierarchy and advocating voluntary cooperation.",
    "populist left": "Rewrite from a populist left view emphasizing working-class struggle and anti-elitism.",
    "populist right": "Rewrite from a populist right view emphasizing national pride and anti-globalism.",
    "conspiracy-core": "Rewrite from a conspiracy-driven lens suspicious of official narratives and elites.",
    "climate doomer": "Rewrite from a climate doomer stance stressing irreversible collapse and ecological despair.",
    "pan-africanist": "Rewrite from a Pan-Africanist lens emphasizing African unity, liberation, and anti-imperialism.",
    "feminist": "Rewrite from a feminist view centering gender equity and patriarchal critique.",
    "libertarian": "Rewrite from a libertarian perspective emphasizing minimal government and individual rights.",
    "eco-socialist": "Rewrite from an eco-socialist stance tying environmental and economic justice together.",
    "transhumanist": "Rewrite from a transhumanist vision highlighting human evolution through technology.",
    "original": "Rewrite clearly, maintaining the original message."
  };

  let promptText = perspectivesMap[perspective.toLowerCase()] || perspectivesMap["original"];

  if (simplified) {
    promptText += " Use plain and clear language.";
  }

  // Instruct AI about length and content
  promptText += ` Keep the rewritten text very concise, aiming for a similar length to the original, around ${maxChars} characters, and avoid introducing new ideas or facts. Focus on the core message.`;

  return `${promptText}\n\n"${text}"\n\nAvoid using Markdown formatting.`;
}