import { afterEach, describe, expect, it } from "bun:test";
import {
  clearVaultCache,
  resolveSecretByHandleId,
  resolveSecretByProviderScope,
  toProviderAuthHeaders,
} from "@/server/vault/adapter";

describe("server vault adapter", () => {
  afterEach(() => {
    clearVaultCache();
  });

  it("resolves handle by id using env-backed secretRef", async () => {
    const resolved = await resolveSecretByHandleId("handle_media", {
      getEnv: (name: string) => {
        if (name === "VAULT_ACCESS_TOKEN") {
          return "abcdefghijklmnopqrstuvwxyz123456";
        }
        if (name === "MEDIA_BACKEND_API_KEY") {
          return "secret_media_key";
        }
        return undefined;
      },
      fetchByHandleId: async () => ({
        handleId: "handle_media",
        provider: "media_backend",
        scope: "storyboard_media",
        status: "active",
        secretRef: "env:MEDIA_BACKEND_API_KEY",
        createdAt: Date.now(),
      }),
      fetchByProviderScope: async () => null,
    });

    expect(resolved).not.toBeNull();
    if (!resolved) {
      throw new Error("Expected resolved secret.");
    }
    expect(resolved.provider).toBe("media_backend");
    expect(resolved.value).toBe("secret_media_key");
  });

  it("rejects unsupported secretRef format", async () => {
    await expect(
      resolveSecretByHandleId("handle_bad", {
        getEnv: (name: string) => {
          if (name === "VAULT_ACCESS_TOKEN") {
            return "abcdefghijklmnopqrstuvwxyz123456";
          }
          return undefined;
        },
        fetchByHandleId: async () => ({
          handleId: "handle_bad",
          provider: "media_backend",
          scope: "storyboard_media",
          status: "active",
          secretRef: "plain:bad",
          createdAt: Date.now(),
        }),
        fetchByProviderScope: async () => null,
      }),
    ).rejects.toThrow("Unsupported secretRef format");
  });

  it("resolves by provider/scope and caches result", async () => {
    let callCount = 0;
    const deps = {
      getEnv: (name: string) => {
        if (name === "VAULT_ACCESS_TOKEN") {
          return "abcdefghijklmnopqrstuvwxyz123456";
        }
        if (name === "LANGSMITH_API_KEY_SECURE") {
          return "ls_secure_key";
        }
        return undefined;
      },
      fetchByHandleId: async () => null,
      fetchByProviderScope: async () => {
        callCount += 1;
        return {
          handleId: "handle_langsmith",
          provider: "langsmith",
          scope: "observability",
          status: "active" as const,
          secretRef: "env:LANGSMITH_API_KEY_SECURE",
          createdAt: Date.now(),
        };
      },
    };

    const first = await resolveSecretByProviderScope("langsmith", "observability", deps);
    const second = await resolveSecretByProviderScope("langsmith", "observability", deps);

    expect(first?.value).toBe("ls_secure_key");
    expect(second?.value).toBe("ls_secure_key");
    expect(callCount).toBe(1);
  });

  it("builds provider auth headers without exposing secret shape errors", () => {
    expect(toProviderAuthHeaders("langsmith", "ls_key")).toEqual({
      "x-langsmith-api-key": "ls_key",
    });
    expect(toProviderAuthHeaders("media_backend", "media_key")).toEqual({
      Authorization: "Bearer media_key",
    });
  });
});
