/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Binding types for the Cloudflare MCP Workspace.
 * Keep in sync with wrangler.jsonc. `wrangler types` may overwrite this file.
 */

interface AnalyticsEngineDataset {
  writeDataPoint(event: {
    blobs?: string[];
    doubles?: number[];
    indexes?: string[];
  }): void;
}

interface SendEmailBinding {
  send(message: unknown): Promise<void>;
}

declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    KV: KVNamespace;
    OAUTH_KV: KVNamespace;
    R2: R2Bucket;
    AI: Ai;
    VECTORIZE: VectorizeIndex;
    INDEX_QUEUE: Queue;
    METRICS?: AnalyticsEngineDataset;
    SEND_EMAIL?: SendEmailBinding;

    MCP_SERVER_NAME: string;
    MCP_SERVER_VERSION: string;
    AUTH_ENABLED: string;
    CORS_ORIGINS: string;
    EMBED_MODEL: string;
    LLM_MODEL: string;
    HTML_DEPLOY_BASE_URL: string;
    DEFAULT_FROM_EMAIL: string;

    GITHUB_CLIENT_ID?: string;
    GITHUB_CLIENT_SECRET?: string;
    COOKIE_ENCRYPTION_KEY?: string;
    HTML_DEPLOY_TOKEN?: string;
    EMAIL_API_URL?: string;
    EMAIL_API_KEY?: string;
    CF_ACCOUNT_ID?: string;
    CF_API_TOKEN?: string;

    OAUTH_PROVIDER?: any;
  }
}

interface Env extends Cloudflare.Env {}
