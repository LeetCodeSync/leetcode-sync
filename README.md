# LeetCode GitHub Sync

> Chrome extension that syncs accepted LeetCode submissions to a GitHub repository.

---

## Overview

LeetCode GitHub Sync is a Chrome Extension built to automatically save accepted LeetCode submissions into a GitHub repository using a simple per-problem folder structure.

Each accepted submission creates a new Git commit, making the repository a clean and traceable history of solved problems.

---

## Architecture

- Chrome Extension, Manifest V3
- React + TypeScript
- Vite
- Background service worker
- Content script on LeetCode problem pages
- GitHub OAuth device flow
- GitHub Git Data API
- One commit per accepted submission

---

## Sync Flow

1. User configures GitHub client ID and target repository.
2. Extension starts GitHub device authorization.
3. User authorizes on GitHub.
4. Extension stores the access token locally.
5. Content script detects an accepted submission on LeetCode.
6. Background worker extracts problem and solution data.
7. Background worker commits the files to GitHub.

---

## Repository Layout

```text
/1-two-sum/
  README.md
  two-sum.py
```

Example generated files:

- `README.md` contains the problem statement and metadata
- `two-sum.py` contains the submitted solution

---

## Security Notes

- No backend
- No client secret embedded in the extension
- Token stored in `chrome.storage.local`
- Permissions limited to LeetCode and GitHub domains

---

## Limitations

- Auth is weaker than a backend-assisted GitHub App setup
- LeetCode parsing is DOM-based and may break if the page changes
- Full problem statement extraction is heuristic
- Service worker lifecycle is non-persistent and must tolerate wake/sleep behavior

## Authentication model

The extension uses GitHub OAuth device flow instead of a GitHub App server-based integration.

Why:
- the extension is fully client-side
- there is no backend to store app private keys or perform secure token exchange
- device flow works without embedding a client secret in the extension

Tradeoff:
- this is weaker than a backend-assisted GitHub App architecture
- access tokens are still stored locally in the extension

This choice is intentional and is currently the best practical authentication model for a no-backend Chrome extension.

---

## Status

Current state:
- TypeScript extension scaffold
- Popup, and side panel structure
- Local storage layer
- GitHub auth flow scaffold
- Initial sync pipeline design

Planned next:
- Harden LeetCode DOM extraction
- Improve deduplication of accepted submission events
- Add better sync visibility and error reporting
- Add tests for pure parsing and helper functions

---

## Development

```bash
npm install
npm run build
```

Then load the `dist/` directory as an unpacked extension in Chrome.

---

## License

MIT
