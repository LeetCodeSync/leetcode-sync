### Chrome browser extension to sync LeetCode submissions into your GitHub repository.



## Stack built as:
	•	Chrome Extension, Manifest V3
	•	React + TypeScript UI (shadcn-style components)
	•	State: Zustand
	•	background service worker for auth + GitHub sync
	•	content script on leetcode.com only, to detect successful submissions and read problem/submission metadata
	•	GitHub App for auth, not a GitHub OAuth app
	•	GitHub Contents API or Git Data API for commits, with one commit per successful submit


## Flow:
	•	extension starts auth via chrome.identity.launchWebAuthFlow
	•	user completes GitHub App user authorization flow
	•	your backend exchanges code for token / refresh token
	•	backend returns only the short-lived user token to extension
	•	extension stores minimal session data
	•	backend can also help refresh tokens

