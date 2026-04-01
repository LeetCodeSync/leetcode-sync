# LeetCode GitHub Sync

Chrome extension that syncs accepted LeetCode submissions to a GitHub repository.

## Stack
- Chrome Extension, Manifest V3
- React + TypeScript
- Vite
- Background service worker
- Content script on LeetCode problem pages
- GitHub OAuth device flow
- GitHub Git Data API
- One commit per accepted submission

## Flow
- User configures GitHub client ID and target repository
- Extension starts GitHub device auth
- User authorizes on GitHub
- Extension stores access token locally
- Content script detects accepted submission on LeetCode
- Background worker extracts and commits files to GitHub
- Each accepted submission creates a new commit

## Repository layout
```text
/1-two-sum/
  README.md
  two-sum.py
```

## Security
- No backend
- Client secret in the extension
- Token stored in chrome.storage.local 
- missions limited to LeetCode and GitHub domains

## Caveats
- Auth is weaker than a backend-assisted GitHub App setup 
- LeetCode parsing is DOM-based and can break if the page changes 
- Full problem statement extraction is heuristic 
- Service worker is non-persistent and must tolerate wake/sleep behavior
