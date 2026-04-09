import { pollForAccessToken, startDeviceFlow } from "./github";
import type { PendingDeviceAuth } from "../types";

describe("src/lib/github.ts", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("startDeviceFlow sends the correct request and returns parsed data", async () => {
    const mockResponse = {
      device_code: "device-code",
      user_code: "ABCD-EFGH",
      verification_uri: "https://github.com/login/device",
      expires_in: 900,
      interval: 5
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse
    } as Response);

    const result = await startDeviceFlow("client-123", "repo");

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://github.com/login/device/code",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded"
        }),
        body: expect.any(URLSearchParams)
      })
    );

    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    const body = options.body as URLSearchParams;

    expect(body.get("client_id")).toBe("client-123");
    expect(body.get("scope")).toBe("repo");
    expect(result).toEqual(mockResponse);
  });

  it("startDeviceFlow throws a friendly error from GitHub response", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        error: "invalid_client",
        error_description: "GitHub client is invalid"
      })
    } as Response);

    await expect(startDeviceFlow("bad-client", "repo")).rejects.toThrow(
      "GitHub client is invalid"
    );
  });

  it("pollForAccessToken returns null when authorization is still pending", async () => {
    const pending: PendingDeviceAuth = {
      deviceCode: "device-1",
      userCode: "AAAA-BBBB",
      verificationUri: "https://github.com/login/device",
      expiresAt: Date.now() + 60_000,
      intervalSeconds: 5
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        error: "authorization_pending"
      })
    } as Response);

    const result = await pollForAccessToken("client-123", pending);

    expect(result).toBeNull();
  });

  it("pollForAccessToken returns null when GitHub asks to slow down", async () => {
    const pending: PendingDeviceAuth = {
      deviceCode: "device-1",
      userCode: "AAAA-BBBB",
      verificationUri: "https://github.com/login/device",
      expiresAt: Date.now() + 60_000,
      intervalSeconds: 5
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        error: "slow_down"
      })
    } as Response);

    const result = await pollForAccessToken("client-123", pending);

    expect(result).toBeNull();
  });

  it("pollForAccessToken returns a normalized session when token is available", async () => {
    const pending: PendingDeviceAuth = {
      deviceCode: "device-1",
      userCode: "AAAA-BBBB",
      verificationUri: "https://github.com/login/device",
      expiresAt: Date.now() + 60_000,
      intervalSeconds: 5
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "token-123",
        token_type: "bearer",
        scope: "repo"
      })
    } as Response);

    const before = Date.now();
    const result = await pollForAccessToken("client-123", pending);
    const after = Date.now();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      accessToken: "token-123",
      tokenType: "bearer",
      scope: "repo",
      createdAt: expect.any(Number)
    });
    expect(result!.createdAt).toBeGreaterThanOrEqual(before);
    expect(result!.createdAt).toBeLessThanOrEqual(after);
  });

  it("pollForAccessToken throws on non-retryable GitHub errors", async () => {
    const pending: PendingDeviceAuth = {
      deviceCode: "device-1",
      userCode: "AAAA-BBBB",
      verificationUri: "https://github.com/login/device",
      expiresAt: Date.now() + 60_000,
      intervalSeconds: 5
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        error: "expired_token",
        error_description: "The device code expired"
      })
    } as Response);

    await expect(
      pollForAccessToken("client-123", pending)
    ).rejects.toThrow("The device code expired");
  });
});
