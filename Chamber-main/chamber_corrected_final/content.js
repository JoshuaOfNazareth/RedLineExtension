// content.js

// Constants for message actions
const ACTION_AUTO_REWRITE = "autoRewrite";
const ACTION_PROCESS_REWRITE = "processRewrite"; // Used for sending messages to background

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === ACTION_AUTO_REWRITE) {
    // Add a class to the body to indicate rewriting is active (for global styling/blur)
    document.body.classList.add('chamber-rewriting-active');

    // Select elements and filter out navigation/sidebar
    const elementsToRewrite = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li"));
    const filteredElements = elementsToRewrite.filter(el => {
      // Exclude elements within common navigation/sidebar/footer containers
      // Added .chamber-no-rewrite class for manual exclusion if needed on specific elements
      return !el.closest("nav, aside, header, footer, menu, .mw-sidebar, .sidebar, .vector-menu, .chamber-no-rewrite");
    });

    // Apply "processing" class to elements that will be rewritten for visual feedback
    filteredElements.forEach(el => {
      el.classList.add('chamber-processing');
    });

    // Start the rewriting process
    rewriteElements(filteredElements, request.perspective, request.simplified)
      .then(() => sendResponse({ status: "Done" }))
      .catch(error => {
        console.error("Chamber (Content) - Auto-rewrite failed:", error);
        sendResponse({ status: "Error", error: error.message || "An unexpected error occurred during rewrite." });
      })
      .finally(() => {
        // Always remove global and element-specific processing classes
        document.body.classList.remove('chamber-rewriting-active');
        filteredElements.forEach(el => {
          el.classList.remove('chamber-processing');
          // Optionally add a class for a brief fade-in or transition after rewrite if desired
          // el.classList.add('chamber-rewritten-done');
        });
      });

    return true; // Keep the message channel open for asynchronous sendResponse
  }
});

/**
 * Rewrites a collection of DOM elements using the AI.
 * @param {HTMLElement[]} elements - Array of elements to rewrite.
 * @param {string} perspective - The chosen ideological perspective.
 * @param {boolean} simplified - Whether to simplify the language.
 * @returns {Promise<void>} - A promise that resolves when all elements are processed.
 */
async function rewriteElements(elements, perspective, simplified) {
  const rewriteTasks = elements.map(async (element) => {
    const originalText = element.innerText.trim();
    const originalCharLimit = originalText.length;

    // Only process elements with meaningful content and within a reasonable length
    // Min length prevents processing single words or empty elements
    // Max length prevents excessively long/expensive API calls for huge blocks of text
    if (originalText.length > 5 && originalText.length < 1500) { // Increased max char for elements
      try {
        const response = await chrome.runtime.sendMessage({
          action: ACTION_PROCESS_REWRITE,
          text: originalText,
          perspective: perspective,
          simplified: simplified,
          maxChars: originalCharLimit // Pass the original character limit to background.js
        });

        if (response && response.rewrittenText) {
          let rewrittenText = response.rewrittenText;

          // Cleanup AI response: remove markdown, normalize whitespace
          let cleanText = rewrittenText
            .replace(/[*_#`~]+/g, '') // Remove common markdown characters
            .replace(/\s+/g, ' ') // Replace multiple spaces/newlines with single space
            .trim();

          // Intelligent Truncation:
          // If the rewritten text is significantly longer than the original,
          // attempt to truncate at the nearest sentence boundary.
          const maxAllowedLength = originalCharLimit * 1.1; // Allow rewritten text to be 10% longer

          if (cleanText.length > maxAllowedLength) {
            // Regex to split into sentences, handling common punctuation.
            // This might need refinement for edge cases or very informal text.
            const sentences = cleanText.match(/[^.!?]+[.!?]|\S+/g) || [];
            let truncatedResult = '';
            for (const sentence of sentences) {
              // Only add if it doesn't push the result too far over the original length
              if ((truncatedResult + sentence).length <= originalCharLimit * 1.05) { // Try to stay within 5% of original
                truncatedResult += sentence;
              } else {
                break; // Stop adding sentences
              }
            }
            if (truncatedResult) {
              cleanText = truncatedResult.trim();
            } else {
              // Fallback to simpler character-based slice if sentence parsing fails or is too short
              cleanText = cleanText.slice(0, originalCharLimit).trim();
            }
          }

          element.innerText = cleanText;
        } else if (response && response.error) {
          console.warn(`Chamber (Content) - Skipping element due to API error: ${response.error}`, originalText);
        }
      } catch (error) {
        console.error("Chamber (Content) - Error processing element:", error, originalText);
      }
    }
  });

  // Use Promise.allSettled to ensure all promises resolve/reject,
  // allowing the UI to update even if some individual rewrites fail.
  await Promise.allSettled(rewriteTasks);
}