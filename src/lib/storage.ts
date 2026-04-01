const getSettings = () => {
    return new Promise((resolve) => {
        chrome.storage.sync.get(
            {
                githubClientId: "",
                githubClientSecret: "",
                githubAccessToken: "",
            },
            (items) => {
                resolve(items);
            }
        );
    });
};

const savePendingDeviceAuth = (data: {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    expiresAt: number;
    intervalSeconds: number;
}) => {
    return new Promise((resolve) => {
        chrome.storage.sync.set(
            {
                pendingDeviceAuth: data,
            },
            () => {
                resolve(true);
            }
        );
};
