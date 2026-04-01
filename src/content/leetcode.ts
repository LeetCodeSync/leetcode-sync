function isProblemPage(): boolean {
  return window.location.pathname.startsWith("/problems/");
}

function init(): void {
  if (!isProblemPage()) return;

  console.log("[leetcode-github-sync] content script loaded");
}

init();
