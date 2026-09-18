/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Binding types for the Cloudflare MCP Workspace.
 * Keep in sync with wrangler.jsonc. `wrangler types` may overwrite this file.
 *
 * Ambient Worker runtime names so `tsc --noEmit` succeeds in CI without
 * requiring `@cloudflare/workers-types` as a direct dependency.
 */

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
  props?: unknown;
}

interface Message<Body = unknown> {
  readonly id: string;
  readonly timestamp: Date;
  readonly body: Body;
  readonly attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

interface MessageBatch<Body = unknown> {
  readonly queue: string;
  readonly messages: Message<Body>[];
}

interface ExportedHandler<Env = unknown, QueueHandlerMessage = unknown> {
  fetch?(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response>;
  queue?(batch: MessageBatch<QueueHandlerMessage>, env: Env, ctx: ExecutionContext): void | Promise<void>;
}

type HeadersInit = Headers | Record<string, string> | Array<[string, string]>;

interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta?: Record<string, unknown>;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  exec(query: string): Promise<unknown>;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

interface KVNamespace {
  get(key: string, type?: "text"): Promise<string | null>;
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    keys: Array<{ name: string }>;
    list_complete: boolean;
    cursor?: string;
  }>;
}

interface R2ObjectBody {
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  json<T = unknown>(): Promise<T>;
  httpMetadata?: { contentType?: string };
}

interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: string | ArrayBuffer | ReadableStream | Blob,
    options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }
  ): Promise<unknown>;
  delete(key: string | string[]): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    objects: Array<{ key: string; size: number; uploaded: Date }>;
    truncated: boolean;
    cursor?: string;
  }>;
  head(key: string): Promise<{ key: string; size: number } | null>;
}

interface Ai {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}

interface VectorizeMatch {
  id: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

interface VectorizeIndex {
  query(
    vector: number[],
    options?: { topK?: number; returnMetadata?: string | boolean; filter?: Record<string, unknown> }
  ): Promise<{ matches: VectorizeMatch[] }>;
  upsert(
    vectors: Array<{ id: string; values: number[]; metadata?: Record<string, unknown> }>
  ): Promise<unknown>;
  deleteByIds(ids: string[]): Promise<unknown>;
}

interface Queue<Body = unknown> {
  send(body: Body): Promise<void>;
  sendBatch(messages: Array<{ body: Body }>): Promise<void>;
}

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
