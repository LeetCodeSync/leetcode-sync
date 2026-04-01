function init() {
  if (!window.location.pathname.startsWith("/problems/")) {
    return;
  }

  console.log("[leetcode-github-sync] content script loaded:", window.location.href);
}

init();
