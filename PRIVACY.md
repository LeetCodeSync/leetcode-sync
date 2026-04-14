# Privacy Policy for LeetCode Sync

LeetCode Sync is a Chrome extension that syncs accepted LeetCode submissions to a user-configured GitHub repository.

## Data processed

LeetCode Sync processes the following data as part of its operation:

- GitHub OAuth App Client ID entered by the user
- Repository URL and selected branch
- Authentication/session data required to complete GitHub device authorization and perform repository operations
- LeetCode problem and accepted submission content required to create the commit (for example: problem identifier/slug, language, and the submitted solution code)

## How data is used

This data is used only to:

- Detect when a LeetCode submission completes with an **Accepted** result
- Connect the user’s GitHub account through the GitHub device authorization flow
- Create commits and write files to the user-configured GitHub repository
- Store extension settings and session state locally to persist configuration across browser sessions

## Data sharing

LeetCode Sync sends data only to the services required for its single purpose:

- GitHub (authorization pages and API) to authenticate and write commits to the user’s repository

LeetCode Sync does not sell user data.
LeetCode Sync does not use user data for advertising.
LeetCode Sync does not use user data for profiling, tracking, or purposes unrelated to the extension’s single purpose.

## Local storage

The extension stores configuration and session state locally in the browser, including repository configuration, branch selection, and authentication/session data required for operation.

## Permissions

LeetCode Sync uses the following Chrome permissions:

- `storage` to save settings and session state locally
- `webRequest` to observe LeetCode submission-related network requests needed to detect when an accepted submission is available for syncing

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
https://github.com/LeetCodeSync/leetcode-sync/issues/new/choose
