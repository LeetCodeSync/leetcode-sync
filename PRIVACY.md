# Privacy Policy for LeetCode Sync

LeetCode Sync is a Chrome extension that syncs accepted LeetCode submissions to a user-configured GitHub repository.

## Data processed

LeetCode Sync may process the following data as part of its operation:

- GitHub OAuth App Client ID entered by the user
- repository URL, selected branch, and sync preferences
- authentication and session data required for GitHub device authorization
- LeetCode problem, submission, and accepted solution content needed for syncing

## How data is used

This data is used only to:

- detect accepted LeetCode submissions
- connect the user's GitHub account through device authorization
- create commits and write files to the user-configured GitHub repository
- store extension settings and session state across browser sessions

## Data sharing

LeetCode Sync sends data only to GitHub services required for authentication and repository operations.

LeetCode Sync does not sell user data.
LeetCode Sync does not use user data for advertising.
LeetCode Sync does not use user data for profiling, tracking, or purposes unrelated to the extension's single purpose.

## Local storage

The extension stores settings and session state locally in the browser, including repository configuration, branch selection, sync preferences, and authentication/session data needed for operation.

## Permissions

LeetCode Sync uses the following permissions:

- `storage` to save settings and session state
- `tabs` to identify the current tab and confirm supported LeetCode pages
- `webRequest` to observe relevant submission-related request and response activity

It also uses host permissions for:

- `https://leetcode.com/*`
- `https://github.com/*`
- `https://api.github.com/*`

## Remote code

LeetCode Sync does not execute remote code. All executable logic is packaged with the extension.

## Changes to this policy

This policy may be updated from time to time. Any changes will be published in this repository.

## Contact

For support, bug reports, or feature requests, visit:
[https://github.com/LeetCodeSync/leetcode-sync/issues/new/choose](https://github.com/LeetCodeSync/leetcode-sync/issues/new/choose)
