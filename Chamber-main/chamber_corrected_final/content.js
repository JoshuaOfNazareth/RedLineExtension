// content.js

// Constants for message actions
const ACTION_AUTO_REWRITE = "autoRewrite";
const ACTION_PROCESS_REWRITE = "processRewrite"; // Used for sending messages to background
const ACTION_SUMMARIZE_TEXT = "summarizeText"; // Used for sending messages to background

function showPreviewDiv(textContent) {
  // Remove existing preview if any
  const existingPreview = document.getElementById('chamber-preview-overlay');
  if (existingPreview) {
    existingPreview.remove();
    document.body.classList.remove('chamber-preview-active');
  }

  const previewOverlay = document.createElement('div');
  previewOverlay.id = 'chamber-preview-overlay'; // For easy removal
  const previewContent = document.createElement('div');
  const closeButton = document.createElement('button');

  // Styles for previewOverlay
  previewOverlay.style.position = 'fixed';
  previewOverlay.style.top = '0';
  previewOverlay.style.left = '0';
  previewOverlay.style.width = '100vw';
  previewOverlay.style.height = '100vh';
  previewOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
  previewOverlay.style.display = 'flex';
  previewOverlay.style.justifyContent = 'center';
  previewOverlay.style.alignItems = 'center';
  previewOverlay.style.zIndex = '9999';

  // Styles for previewContent
  previewContent.style.backgroundColor = 'white';
  previewContent.style.padding = '20px';
  previewContent.style.borderRadius = '8px';
  previewContent.style.maxWidth = '80%';
  previewContent.style.maxHeight = '80vh';
  previewContent.style.overflowY = 'auto';
  previewContent.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
  previewContent.style.whiteSpace = 'pre-wrap'; // Respect newlines
  previewContent.style.position = 'relative'; // For close button positioning

  // Styles for closeButton
  closeButton.style.position = 'absolute';
  closeButton.style.top = '10px';
  closeButton.style.right = '10px';
  closeButton.style.padding = '5px 10px';
  closeButton.style.cursor = 'pointer';
  closeButton.style.border = 'none';
  closeButton.style.backgroundColor = '#eee';
  closeButton.style.borderRadius = '4px';

  previewContent.textContent = textContent;
  closeButton.textContent = 'Close';

  closeButton.onclick = () => {
    previewOverlay.remove();
    document.body.classList.remove('chamber-preview-active');
  };

  previewContent.appendChild(closeButton);
  previewOverlay.appendChild(previewContent);
  document.body.appendChild(previewOverlay);
  document.body.classList.add('chamber-preview-active');
}


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === ACTION_AUTO_REWRITE) {
    // document.body.classList.add('chamber-rewriting-active'); // Removed as per instructions

    const elementsToConsider = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li"));
    const filteredElementsForText = elementsToConsider.filter(el => {
      return !el.closest("nav, aside, header, footer, menu, .mw-sidebar, .sidebar, .vector-menu, .chamber-no-rewrite");
    });

    let fullArticleText = "";
    filteredElementsForText.forEach(el => {
      fullArticleText += el.innerText.trim() + "\n\n"; // Add double newline for paragraph separation
    });

    const articleLength = fullArticleText.length;
    let rewriteStrategy = "short"; // Default

    if (articleLength >= 2000 && articleLength <= 6000) {
      rewriteStrategy = "summarizeThenRewrite";
    } else if (articleLength > 6000) {
      rewriteStrategy = "chunkThenRewrite";
    }

    console.log("Chamber (Content) - Article Length:", articleLength, "Chosen Strategy:", rewriteStrategy);

    // Apply "processing" class to elements that will be rewritten for visual feedback (only for short strategy for now)
    // For other strategies, the visual feedback might be different or applied later.
    if (rewriteStrategy === "short") {
      filteredElementsForText.forEach(el => {
        el.classList.add('chamber-processing');
      });
    }

    if (rewriteStrategy === "short") {
      rewriteElements(filteredElementsForText, request.perspective, request.simplified)
        .then(rewrittenArticleText => {
          showPreviewDiv(rewrittenArticleText);
          sendResponse({ status: "Done", strategy: "short" });
        })
        .catch(error => {
          console.error("Chamber (Content) - Auto-rewrite failed (short strategy):", error);
          sendResponse({ status: "Error", error: error.message || "An unexpected error occurred during rewrite." });
        })
        .finally(() => {
          // document.body.classList.remove('chamber-rewriting-active'); // Removed
          filteredElementsForText.forEach(el => {
            el.classList.remove('chamber-processing');
          });
        });
    } else if (rewriteStrategy === "summarizeThenRewrite") {
      console.log("Chamber (Content) - Strategy: summarizeThenRewrite. Full text length:", fullArticleText.length);
      chrome.runtime.sendMessage({
        action: ACTION_SUMMARIZE_TEXT,
        text: fullArticleText,
        perspective: request.perspective,
        simplified: request.simplified,
        maxSummaryChars: 800
      }, async (summaryResponse) => {
        if (chrome.runtime.lastError) {
          console.error("Chamber (Content) - Summarization error (initial message):", chrome.runtime.lastError.message);
          // document.body.classList.remove('chamber-rewriting-active'); // Removed
          sendResponse({ status: "Error", error: "Failed to get summary due to runtime error." });
          return;
        }
        if (summaryResponse && summaryResponse.summarizedText) {
          const summary = summaryResponse.summarizedText;
          console.log("Chamber (Content) - Summary received (length):", summary.length, "\nSummary:", summary.substring(0,200)+"...");

          try {
            const rewrittenSummaryResponse = await chrome.runtime.sendMessage({
              action: ACTION_PROCESS_REWRITE,
              text: summary,
              perspective: request.perspective,
              simplified: request.simplified,
              maxChars: Math.floor(summary.length * 1.2)
            });

            if (rewrittenSummaryResponse && rewrittenSummaryResponse.rewrittenText) {
              const finalContent = rewrittenSummaryResponse.rewrittenText;
              console.log("Chamber (Content) - Rewritten summary:", finalContent.substring(0,200)+"...");
              showPreviewDiv(finalContent);
              sendResponse({ status: "Done", strategy: "summarizeThenRewrite" });
            } else {
              console.error("Chamber (Content) - Failed to rewrite summary. Response:", rewrittenSummaryResponse);
              sendResponse({ status: "Error", error: rewrittenSummaryResponse.error || "Failed to rewrite summary." });
            }
          } catch (error) {
            console.error("Chamber (Content) - Error during summary rewrite:", error);
            sendResponse({ status: "Error", error: "Exception during summary rewrite." });
          }
        } else {
          console.error("Chamber (Content) - Summarization failed or empty summary. Response:", summaryResponse);
          sendResponse({ status: "Error", error: summaryResponse.error || "Failed to get summary or summary was empty." });
        }
        // document.body.classList.remove('chamber-rewriting-active'); // Removed
      });
    } else if (rewriteStrategy === "chunkThenRewrite") {
      console.log("Chamber (Content) - Strategy: chunkThenRewrite");
      console.log("Chamber (Content) - Full article text length for chunkThenRewrite:", fullArticleText.length);
      
      (async () => {
        try {
          const chunks = splitTextIntoChunks(fullArticleText, 4);
          if (!chunks || chunks.length === 0 || chunks.every(c => c.trim() === "")) {
            console.warn("Chamber (Content) - No content to process after chunking or all chunks are empty.");
            sendResponse({ status: "Error", error: "No content to process after chunking." });
            // document.body.classList.remove('chamber-rewriting-active'); // Removed
            return;
          }

          console.log(`Chamber (Content) - Split into ${chunks.length} chunks.`);
          const rewrittenChunks = [];

          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            if (chunk.trim() === "") {
              rewrittenChunks.push("");
              continue;
            }
            try {
              const rewriteResponse = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({
                  action: ACTION_PROCESS_REWRITE,
                  text: chunk,
                  perspective: request.perspective,
                  simplified: request.simplified,
                  maxChars: Math.floor(chunk.length * 1.2)
                }, response => {
                  if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                  } else if (response && response.rewrittenText) {
                    resolve(response.rewrittenText);
                  } else {
                    reject(new Error(response.error || "Failed to rewrite chunk."));
                  }
                });
              });
              rewrittenChunks.push(rewriteResponse);
            } catch (error) {
              console.error(`Chamber (Content) - Error rewriting chunk ${i + 1}/${chunks.length}:`, error);
              rewrittenChunks.push(`[Error rewriting chunk: ${chunk.substring(0, 50)}...]`);
            }
          }

          const finalContent = rewrittenChunks.join('\n\n');
          showPreviewDiv(finalContent);
          sendResponse({ status: "Done", strategy: "chunkThenRewrite" });
        } catch (error) {
          console.error("Chamber (Content) - Error during chunked rewriting process:", error);
          sendResponse({ status: "Error", error: "An error occurred during the chunked rewriting process." });
        } finally {
          // document.body.classList.remove('chamber-rewriting-active'); // Removed
        }
      })();
    } else {
      console.warn("Chamber (Content) - Unknown rewrite strategy:", rewriteStrategy);
      // document.body.classList.remove('chamber-rewriting-active'); // Removed
      sendResponse({ status: "Error", error: "Unknown rewrite strategy" });
    }

    return true; 
  }
});

/**
 * Rewrites a collection of DOM elements using the AI and returns concatenated rewritten text.
 * @param {HTMLElement[]} elements - Array of elements to rewrite.
 * @param {string} perspective - The chosen ideological perspective.
 * @param {boolean} simplified - Whether to simplify the language.
 * @returns {Promise<string>} - A promise that resolves with all rewritten texts joined by '\n\n'.
 */
async function rewriteElements(elements, perspective, simplified) {
  let allRewrittenTexts = [];
  const rewriteTasks = elements.map(async (element) => {
    const originalText = element.innerText.trim();
    const originalCharLimit = originalText.length;

    if (originalText.length > 5 && originalText.length < 1500) {
      try {
        const response = await chrome.runtime.sendMessage({
          action: ACTION_PROCESS_REWRITE,
          text: originalText,
          perspective: perspective,
          simplified: simplified,
          maxChars: originalCharLimit
        });

        if (response && response.rewrittenText) {
          let rewrittenText = response.rewrittenText;
          let cleanText = rewrittenText
            .replace(/[*_#`~]+/g, '')
            .replace(/\s+/g, ' ')
            .trim();

          const maxAllowedLength = originalCharLimit * 1.1;
          if (cleanText.length > maxAllowedLength) {
            const sentences = cleanText.match(/[^.!?]+[.!?]|\S+/g) || [];
            let truncatedResult = '';
            for (const sentence of sentences) {
              if ((truncatedResult + sentence).length <= originalCharLimit * 1.05) {
                truncatedResult += sentence;
              } else {
                break;
              }
            }
            cleanText = truncatedResult ? truncatedResult.trim() : cleanText.slice(0, originalCharLimit).trim();
          }
          allRewrittenTexts.push(cleanText); // Add to array instead of modifying element
        } else if (response && response.error) {
          console.warn(`Chamber (Content) - Skipping element due to API error: ${response.error}`, originalText);
          allRewrittenTexts.push(`[Error processing text: ${originalText.substring(0,30)}...]`); // Add placeholder for error
        }
      } catch (error) {
        console.error("Chamber (Content) - Error processing element:", error, originalText);
        allRewrittenTexts.push(`[Exception processing text: ${originalText.substring(0,30)}...]`); // Add placeholder for exception
      }
    } else if (originalText.length > 0) { // If element has some text but not in processable range
        allRewrittenTexts.push(originalText); // Keep original short/empty text
    }
  });

  return Promise.allSettled(rewriteTasks).then(() => allRewrittenTexts.join('\n\n'));
}

/**
 * Splits text into chunks based on paragraph count.
 * @param {string} text - The full text to split.
 * @param {number} paragraphsPerChunk - Number of paragraphs to include in each chunk.
 * @returns {string[]} An array of text chunks.
 */
function splitTextIntoChunks(text, paragraphsPerChunk = 4) {
  if (!text) return [];
  const paragraphs = text.split('\n\n');
  const chunks = [];
  for (let i = 0; i < paragraphs.length; i += paragraphsPerChunk) {
    const chunkParagraphs = paragraphs.slice(i, i + paragraphsPerChunk);
    chunks.push(chunkParagraphs.join('\n\n'));
  }
  return chunks.filter(chunk => chunk.trim() !== ''); // Ensure no empty chunks are returned
}