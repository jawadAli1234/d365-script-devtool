(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_PANEL_VISIBILITY" }, () => {
        // Accessing chrome.runtime.lastError here marks it as "handled" so
        // it doesn't surface as an uncaught error. This is the expected,
        // normal case when clicking the icon on a non-D365 tab - there's
        // nothing to toggle, and nothing the user needs to see about it.
        void chrome.runtime.lastError;
      });
    }
  } catch (e) {
    console.error("[D365 devtool] Popup toggle failed:", e);
  }
  window.close();
})();
