import type { ToolDef } from "./catalog.ts";

export type PlatformEnv = {
  RMS_API_BASE_URL?: string;
  RMS_API_KEY?: string;
  RMS_PLATFORM_EXECUTE?: string;
};

export type PlannedRequest = {
  method: ToolDef["method"];
  url: string;
  path: string;
  body?: Record<string, unknown>;
  query?: Record<string, string>;
};

export type InvokeResult = {
  ok: false;
  code: "not_implemented";
  tool: string;
  product: string;
  phase: ToolDef["phase"];
  billing: ToolDef["billing"];
  request: PlannedRequest;
  note: string;
};

const PATH_PARAM = /\{([a-zA-Z0-9_]+)\}/g;

export class RmsClient {
  private readonly env: PlatformEnv;

  constructor(env: PlatformEnv = {}) {
    this.env = env;
  }

  plan(tool: ToolDef, input: Record<string, unknown>): PlannedRequest {
    const data = { ...input };
    const path = tool.path.replace(PATH_PARAM, (_match, key: string) => {
      const value = data[key];
      if (typeof value !== "string" || !value) {
        throw new Error(`Missing path parameter ${key} for ${tool.name}`);
      }
      delete data[key];
      return encodeURIComponent(value);
    });
    const base = (this.env.RMS_API_BASE_URL || "https://api.registermysite.com").replace(/\/$/, "");
    if (tool.method === "GET" || tool.method === "DELETE") {
      const query: Record<string, string> = {};
      for (const [key, value] of Object.entries(data)) {
        if (value == null) continue;
        query[key] = typeof value === "string" ? value : JSON.stringify(value);
      }
      const qs = new URLSearchParams(query).toString();
      return { method: tool.method, path, url: `${base}${path}${qs ? `?${qs}` : ""}`, query };
    }
    return { method: tool.method, path, url: `${base}${path}`, body: data };
  }

  async invoke(tool: ToolDef, input: Record<string, unknown>): Promise<InvokeResult> {
    const request = this.plan(tool, input);
    if (this.env.RMS_PLATFORM_EXECUTE === "1") {
      throw new Error(
        "RMS_PLATFORM_EXECUTE=1 is reserved for the gateway implementation. This scaffold never sends the request.",
      );
    }
    return {
      ok: false,
      code: "not_implemented",
      tool: tool.name,
      product: tool.product,
      phase: tool.phase,
      billing: tool.billing,
      request,
      note: "Scaffold only. The product call is described in docs/rms-platform-api.md and is not sent.",
    };
  }
}

export function envFromProcess(source: NodeJS.ProcessEnv = process.env): PlatformEnv {
  return {
    RMS_API_BASE_URL: source.RMS_API_BASE_URL,
    RMS_API_KEY: source.RMS_API_KEY,
    RMS_PLATFORM_EXECUTE: source.RMS_PLATFORM_EXECUTE,
  };
}
