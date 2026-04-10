import { handleCompletedRequest, handleRuntimeMessage } from "./handlers";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void handleRuntimeMessage(message, sendResponse);
  return true;
});

chrome.webRequest.onCompleted.addListener(
  (details) => {
    handleCompletedRequest(details);
  },
  {
    urls: ["https://leetcode.com/problems/*/submit/"]
  }
);
