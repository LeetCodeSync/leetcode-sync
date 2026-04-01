### Chrome browser extension to sync LeetCode submissions into your GitHub repository.


## Stack built as:
    •   Chrome Extension, Manifest V3
    •   React + TypeScript UI
    •   Vite for bundling/build
    •   background service worker for auth orchestration + GitHub sync
    •   content script on leetcode.com problem pages only
    •   chrome.storage.local for settings, auth session, pending auth state, and sync history
    •   GitHub OAuth device flow for auth
    •   GitHub Git Data API for blobs / trees / commits / ref updates
    •   One commit per accepted LeetCode submission


## Main extension surfaces:
    •   popup for connect/disconnect, quick status, and navigation
    •   options page for GitHub client ID, repo owner/name, branch, and sync settings
    •   side panel for recent sync history and lightweight progress stats
    •   background worker as central coordinator
    •   content script as LeetCode page observer/extractor


## Flow:
    •   user installs extension
    •   user enters GitHub OAuth App client ID and target repo settings
    •   extension starts GitHub device flow
    •   GitHub returns device_code, user_code, verification_uri, interval, expiry
    •   extension stores pending auth state locally
    •   user opens GitHub verification page and enters code
    •   background worker polls GitHub token endpoint until authorization completes
    •   extension stores returned access token in chrome.storage.local
    •   user submits solution on a LeetCode problem page
    •   content script detects accepted state
    •   content script extracts problem number, slug, title, difficulty, language, code, and statement text
    •   content script sends normalized submission payload to background worker
    •   background worker validates auth + repo settings
    •   background worker creates or updates:
            /1-two-sum/README.md
            /1-two-sum/two-sum.py
    •   background worker creates a new Git commit and moves branch head
    •   background worker stores sync result in local history
    •   side panel reads local history and renders recent activity / counts


## GitHub write strategy:
    •   resolve current branch HEAD
    •   read current commit/tree SHA
    •   create blob for README.md
    •   create blob for code file
    •   create new tree based on current tree
    •   create commit with parent = current HEAD
    •   update refs/heads/<branch> to new commit SHA


## Repo layout:
    •   no top-level /problems folder
    •   one folder per problem
    •   folder name format:
            /<number>-<slug>/
    •   example:
            /1-two-sum/
              README.md
              two-sum.py
    •   repeated accepted submissions update the same code file
    •   each accepted submission still creates a new commit


## Auth / security setup:
    •   no backend / no hosted auth service
    •   no client secret embedded in extension
    •   GitHub OAuth device flow only
    •   token stored in chrome.storage.local, not sync storage
    •   minimal persistent auth state
    •   host permissions limited to leetcode.com, github.com, and api.github.com
    •   no remote code execution
    •   all extension logic bundled into MV3 package
    •   service worker acts as the only sync/auth coordinator

## Caveats:
    •   no backend means weaker auth posture than a server-assisted GitHub App setup
    •   access token still exists locally in the extension
    •   LeetCode extraction is DOM-based and can break if page structure changes
    •   accepted-submission detection needs dedupe protection against rerenders / repeated observers
    •   full README extraction from page content is heuristic, not guaranteed stable
    •   service worker lifecycle is non-persistent, so long-running flows must tolerate wake/sleep behavior
    •   manual repo owner/name/branch config is simpler now, but less polished than a repo picker
