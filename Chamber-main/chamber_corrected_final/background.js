// background.js

// Constants for message actions
const ACTION_PROCESS_REWRITE = "processRewrite";

// Placeholder for API Key - REPLACE WITH SECURE METHOD (e.g., user input and chrome.storage)
const DEEPSEEK_API_KEY = "sk-30252b2145d44f7aae00c42d28a8341a"; // WARNING: This API key is publicly visible.
const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-chat";

// Listener for messages from popup.js or content.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === ACTION_PROCESS_REWRITE) {
    getRewrittenText(request.text, request.perspective, request.simplified, request.maxChars)
      .then(rewrittenText => {
        sendResponse({ rewrittenText });
      })
      .catch(err => {
        console.error("Chamber (Background) - API Error:", err);
        sendResponse({ rewrittenText: null, error: err.message || "Unknown API error" });
      });

    return true; // Indicates that sendResponse will be called asynchronously
  }
});

/**
 * Calls the DeepSeek API to get rewritten text.
 * @param {string} text - The original text to rewrite.
 * @param {string} perspective - The chosen ideological perspective.
 * @param {boolean} simplified - Whether to simplify the language.
 * @param {number} maxChars - The estimated maximum character length desired for the output.
 * @returns {Promise<string>} - A promise that resolves with the rewritten text.
 */
async function getRewrittenText(text, perspective, simplified, maxChars) {
  // Pass maxChars to the prompt creation to guide the AI
  const prompt = createPrompt(text, perspective, simplified, maxChars);

  // Estimate tokens based on characters (e.g., 1 token ~ 3.5 characters for English).
  // Cap max_tokens at 250 for efficiency, but ensure a minimum of 50 tokens for meaningful response
  const estimatedTokens = Math.ceil(maxChars / 3.5);
  const maxTokensForAPI = Math.min(250, Math.max(50, estimatedTokens));

  console.log(`Rewriting: "${text.substring(0, 50)}..." | Max Chars: ${maxChars} | Estimated Tokens: ${estimatedTokens} | API Max Tokens: ${maxTokensForAPI}`);


  const requestBody = {
    model: DEEPSEEK_MODEL,
    messages: [{ role: "user", content: prompt }],
    max_tokens: maxTokensForAPI, // Use the calculated and capped max_tokens
    temperature: 0.7
  };

  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `HTTP ${response.status}: ${errorText}`;
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error && errorJson.error.message) {
          errorMessage = `API Error (${response.status}): ${errorJson.error.message}`;
        }
      } catch (e) {
        // Not JSON, use plain text
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();

    if (data.choices && data.choices.length > 0 && data.choices[0].message) {
      return data.choices[0].message.content.trim();
    } else {
      throw new Error("Failed to get valid response from AI. No choices or message found.");
    }
  } catch (error) {
    console.error("Chamber (Background) - Fetch Error:", error);
    throw new Error(`Network or API call failed: ${error.message}`);
  }
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