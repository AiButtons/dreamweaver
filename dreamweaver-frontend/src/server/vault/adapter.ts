import { ConvexHttpClient } from "convex/browser";
import type { FunctionReference } from "convex/server";

type SecretHandleServerRecord = {
  handleId: string;
  provider: string;
  scope: string;
  status: "active" | "revoked";
  secretRef: string;
  createdAt: number;
};

type ResolverDependencies = {
  getEnv: (name: string) => string | undefined;
  fetchByHandleId: (handleId: string, vaultAccessToken: string) => Promise<SecretHandleServerRecord | null>;
  fetchByProviderScope: (
    provider: string,
    scope: string,
    vaultAccessToken: string,
  ) => Promise<SecretHandleServerRecord | null>;
};

export type ResolvedVaultSecret = {
  handleId: string;
  provider: string;
  scope: string;
  value: string;
};

const secretRefPattern = /^env:[A-Z][A-Z0-9_]*$/;
const handleCache = new Map<string, ResolvedVaultSecret>();

const resolveSecretRef = (secretRef: string, getEnv: (name: string) => string | undefined) => {
  if (!secretRefPattern.test(secretRef)) {
    throw new Error("Unsupported secretRef format. Only env:VAR_NAME is allowed.");
  }
  const envName = secretRef.slice(4);
  const secretValue = getEnv(envName);
  if (!secretValue || secretValue.length === 0) {
    throw new Error(`Vault secret env var not set: ${envName}`);
  }
  return secretValue;
};

const createConvexFetchers = (): Pick<
  ResolverDependencies,
  "fetchByHandleId" | "fetchByProviderScope"
> => {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured.");
  }
  const client = new ConvexHttpClient(convexUrl);
  const queryRef = (path: string) =>
    path as unknown as FunctionReference<"query">;
  return {
    fetchByHandleId: async (handleId: string, vaultAccessToken: string) =>
      await client.query(queryRef("secretHandles:getHandleForServer"), {
        handleId,
        vaultAccessToken,
      }) as SecretHandleServerRecord | null,
    fetchByProviderScope: async (
      provider: string,
      scope: string,
      vaultAccessToken: string,
    ) =>
      await client.query(queryRef("secretHandles:getHandleByProviderScopeForServer"), {
        provider,
        scope,
        vaultAccessToken,
      }) as SecretHandleServerRecord | null,
  };
};

const defaultDependencies = (): ResolverDependencies => {
  const fetchers = createConvexFetchers();
  return {
    getEnv: (name: string) => process.env[name],
    fetchByHandleId: fetchers.fetchByHandleId,
    fetchByProviderScope: fetchers.fetchByProviderScope,
  };
};

const toCacheKey = (handleId: string) => `handle:${handleId}`;
const toProviderScopeKey = (provider: string, scope: string) => `provider:${provider}:${scope}`;

const validateVaultToken = (getEnv: (name: string) => string | undefined) => {
  const vaultToken = getEnv("VAULT_ACCESS_TOKEN");
  if (!vaultToken || vaultToken.length < 24) {
    throw new Error("VAULT_ACCESS_TOKEN is missing or too short.");
  }
  return vaultToken;
};

export const clearVaultCache = () => {
  handleCache.clear();
};

export const resolveSecretByHandleId = async (
  handleId: string,
  deps?: Partial<ResolverDependencies>,
): Promise<ResolvedVaultSecret | null> => {
  const dependencies: ResolverDependencies = {
    ...defaultDependencies(),
    ...deps,
  };
  const cached = handleCache.get(toCacheKey(handleId));
  if (cached) {
    return cached;
  }
  const vaultToken = validateVaultToken(dependencies.getEnv);
  const record = await dependencies.fetchByHandleId(handleId, vaultToken);
  if (!record || record.status !== "active") {
    return null;
  }
  const value = resolveSecretRef(record.secretRef, dependencies.getEnv);
  const resolved: ResolvedVaultSecret = {
    handleId: record.handleId,
    provider: record.provider,
    scope: record.scope,
    value,
  };
  handleCache.set(toCacheKey(handleId), resolved);
  handleCache.set(toProviderScopeKey(record.provider, record.scope), resolved);
  return resolved;
};

export const resolveSecretByProviderScope = async (
  provider: string,
  scope: string,
  deps?: Partial<ResolverDependencies>,
): Promise<ResolvedVaultSecret | null> => {
  const dependencies: ResolverDependencies = {
    ...defaultDependencies(),
    ...deps,
  };
  const cached = handleCache.get(toProviderScopeKey(provider, scope));
  if (cached) {
    return cached;
  }
  const vaultToken = validateVaultToken(dependencies.getEnv);
  const record = await dependencies.fetchByProviderScope(provider, scope, vaultToken);
  if (!record || record.status !== "active") {
    return null;
  }
  const value = resolveSecretRef(record.secretRef, dependencies.getEnv);
  const resolved: ResolvedVaultSecret = {
    handleId: record.handleId,
    provider: record.provider,
    scope: record.scope,
    value,
  };
  handleCache.set(toCacheKey(record.handleId), resolved);
  handleCache.set(toProviderScopeKey(provider, scope), resolved);
  return resolved;
};

export const toProviderAuthHeaders = (
  provider: string,
  secretValue: string,
): Record<string, string> => {
  const normalizedProvider = provider.trim().toLowerCase();
  if (normalizedProvider === "langsmith") {
    return { "x-langsmith-api-key": secretValue };
  }
  if (normalizedProvider === "media_backend" || normalizedProvider === "openai") {
    return { Authorization: `Bearer ${secretValue}` };
  }
  return { Authorization: `Bearer ${secretValue}` };
};
