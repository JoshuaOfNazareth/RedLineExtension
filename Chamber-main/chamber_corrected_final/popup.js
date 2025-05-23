// popup.js

// Constants for message actions
const ACTION_AUTO_REWRITE = "autoRewrite";

document.addEventListener('DOMContentLoaded', () => {
  const rewriteBtn = document.getElementById('rewriteBtn');
  const perspectiveSelect = document.getElementById('perspective');
  const simplifiedCheckbox = document.getElementById('simplified');
  const statusDiv = document.getElementById('status');

  // Load saved settings when popup opens
  chrome.storage.sync.get(['selectedPerspective', 'simplifiedMode'], (result) => {
    if (result.selectedPerspective) {
      perspectiveSelect.value = result.selectedPerspective;
    }
    if (result.simplifiedMode !== undefined) {
      simplifiedCheckbox.checked = result.simplifiedMode;
    }
  });

  // Save settings when they change
  perspectiveSelect.addEventListener('change', () => {
    chrome.storage.sync.set({ selectedPerspective: perspectiveSelect.value });
  });

  simplifiedCheckbox.addEventListener('change', () => {
    chrome.storage.sync.set({ simplifiedMode: simplifiedCheckbox.checked });
  });

  rewriteBtn.onclick = () => {
    statusDiv.textContent = "Processing..."; // Indicate loading
    statusDiv.style.color = '#1a73e8'; // Blue for processing

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length === 0) {
        statusDiv.textContent = "Error: No active tab found.";
        statusDiv.style.color = '#d93025'; // Red for error
        return;
      }

      chrome.tabs.sendMessage(tabs[0].id, {
        action: ACTION_AUTO_REWRITE,
        perspective: perspectiveSelect.value,
        simplified: simplifiedCheckbox.checked
      }, (response) => {
        // Check for runtime errors, e.g., content script not injected
        if (chrome.runtime.lastError) {
          console.error("Chamber (Popup) - Runtime Error:", chrome.runtime.lastError.message);
          statusDiv.textContent = "Error: Cannot connect to page script. Try refreshing the page.";
          statusDiv.style.color = '#d93025';
          return;
        }

        // Handle response from content script
        if (response && response.status === "Done") {
          statusDiv.textContent = "Done!";
          statusDiv.style.color = '#188038'; // Green for success
        } else if (response && response.status === "Error") {
          statusDiv.textContent = `Error: ${response.error || "Unknown error during rewrite."}`;
          statusDiv.style.color = '#d93025';
        } else {
          statusDiv.textContent = "Unknown response.";
          statusDiv.style.color = '#d93025';
        }
      });
    });
  };
});