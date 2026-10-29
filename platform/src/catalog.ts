import { z, type ZodType } from "zod";

export type Billing = "free" | "metered" | "paid";
export type Phase = 1 | 2 | 3;
export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export type ToolDef = {
  name: string;
  cli: readonly string[];
  description: string;
  product: string;
  phase: Phase;
  billing: Billing;
  method: HttpMethod;
  path: string;
  schema: ZodType;
};

const id = z.string().min(1).max(128);
const originValue = z.string().min(1).max(200);
const origins = z
  .preprocess(
    (value) => (typeof value === "string" ? [value] : value),
    z.array(originValue).max(20),
  )
  .describe("Hostname or origin. Repeat the flag, or pass one value. The gateway stores https://host.");

function obj<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).strict();
}

export const tools: ToolDef[] = [
  {
    name: "rms_whoami",
    cli: ["whoami"],
    description: "Return the RMS account bound to the current API key.",
    product: "account",
    phase: 1,
    billing: "free",
    method: "GET",
    path: "/v1/me",
    schema: obj({}),
  },
  {
    name: "rms_bots_list",
    cli: ["bots", "list"],
    description: "List BotForge bots owned by the caller.",
    product: "botforge",
    phase: 1,
    billing: "free",
    method: "GET",
    path: "/v1/bots",
    schema: obj({}),
  },
  {
    name: "rms_bots_create",
    cli: ["bots", "create"],
    description: "Create a BotForge bot, optionally attach knowledge and allowed origins, and return the embed snippet. Does not create a bot when the caller omits a name.",
    product: "botforge",
    phase: 1,
    billing: "paid",
    method: "POST",
    path: "/v1/bots",
    schema: obj({
      name: z.string().min(1).max(80),
      idempotencyKey: z.string().min(8).max(80).optional(),
      model: z.string().max(120).optional(),
      systemPrompt: z.string().max(8000).optional(),
      welcomeMessage: z.string().max(500).optional(),
      knowledge: z.string().max(100_000).optional().describe("Pasted note ingested as one document."),
      knowledgeUrl: z.string().max(2000).optional(),
      origins: origins.optional(),
    }),
  },
  {
    name: "rms_bots_get",
    cli: ["bots", "get"],
    description: "Fetch one BotForge bot.",
    product: "botforge",
    phase: 1,
    billing: "free",
    method: "GET",
    path: "/v1/bots/{id}",
    schema: obj({ id }),
  },
  {
    name: "rms_bots_update",
    cli: ["bots", "update"],
    description: "Patch bot name, prompt, model, or theme.",
    product: "botforge",
    phase: 1,
    billing: "free",
    method: "PATCH",
    path: "/v1/bots/{id}",
    schema: obj({
      id,
      name: z.string().min(1).max(80).optional(),
      model: z.string().max(120).optional(),
      systemPrompt: z.string().max(8000).optional(),
      welcomeMessage: z.string().max(500).optional(),
    }),
  },
  {
    name: "rms_bots_add_knowledge",
    cli: ["bots", "knowledge"],
    description: "Add a pasted note or a URL to a bot's knowledge.",
    product: "botforge",
    phase: 1,
    billing: "paid",
    method: "POST",
    path: "/v1/bots/{id}/documents",
    schema: obj({
      id,
      text: z.string().max(100_000).optional(),
      url: z.string().max(2000).optional(),
      title: z.string().max(200).optional(),
    }),
  },
  {
    name: "rms_bots_set_origins",
    cli: ["bots", "origins"],
    description: "Replace a bot's allowed origins. Values are normalized to origins with a scheme.",
    product: "botforge",
    phase: 1,
    billing: "free",
    method: "PUT",
    path: "/v1/bots/{id}/origins",
    schema: obj({
      id,
      origins,
    }),
  },
  {
    name: "rms_bots_embed",
    cli: ["bots", "embed"],
    description: "Return the public widget snippet for a deployed bot.",
    product: "botforge",
    phase: 1,
    billing: "free",
    method: "GET",
    path: "/v1/bots/{id}/embed",
    schema: obj({ id }),
  },
  {
    name: "rms_bots_delete",
    cli: ["bots", "delete"],
    description: "Delete a bot.",
    product: "botforge",
    phase: 1,
    billing: "free",
    method: "DELETE",
    path: "/v1/bots/{id}",
    schema: obj({ id }),
  },
  {
    name: "rms_forms_list",
    cli: ["forms", "list"],
    description: "List EdgeForms forms owned by the caller.",
    product: "forms",
    phase: 1,
    billing: "free",
    method: "GET",
    path: "/v1/forms",
    schema: obj({}),
  },
  {
    name: "rms_forms_create",
    cli: ["forms", "create"],
    description: "Create a form with fields and a destination email. Returns the embed HTML and the public POST endpoint.",
    product: "forms",
    phase: 1,
    billing: "paid",
    method: "POST",
    path: "/v1/forms",
    schema: obj({
      name: z.string().min(1).max(80),
      destinationEmail: z.string().email(),
      idempotencyKey: z.string().min(8).max(80).optional(),
      fields: z.array(z.record(z.string(), z.unknown())).min(1).max(40),
      origins: origins.optional(),
      theme: z.enum(["light", "dark", "auto"]).optional(),
    }),
  },
  {
    name: "rms_forms_get",
    cli: ["forms", "get"],
    description: "Fetch one form, including its endpoint and embed.",
    product: "forms",
    phase: 1,
    billing: "free",
    method: "GET",
    path: "/v1/forms/{id}",
    schema: obj({ id }),
  },
  {
    name: "rms_forms_embed",
    cli: ["forms", "embed"],
    description: "Return embed HTML for a form.",
    product: "forms",
    phase: 1,
    billing: "free",
    method: "GET",
    path: "/v1/forms/{id}/embed",
    schema: obj({ id }),
  },
  {
    name: "rms_forms_delete",
    cli: ["forms", "delete"],
    description: "Delete a form and its submission index.",
    product: "forms",
    phase: 1,
    billing: "free",
    method: "DELETE",
    path: "/v1/forms/{id}",
    schema: obj({ id }),
  },
  {
    name: "rms_analytics_sites_list",
    cli: ["analytics", "list"],
    description: "List EdgeTrack sites owned by the caller.",
    product: "edgetrack",
    phase: 1,
    billing: "free",
    method: "GET",
    path: "/v1/analytics/sites",
    schema: obj({}),
  },
  {
    name: "rms_analytics_sites_create",
    cli: ["analytics", "create"],
    description: "Create an EdgeTrack site and return its et_live_ key plus the tracker snippet.",
    product: "edgetrack",
    phase: 1,
    billing: "paid",
    method: "POST",
    path: "/v1/analytics/sites",
    schema: obj({
      name: z.string().min(1).max(120),
      domain: z.string().min(1).max(200),
      idempotencyKey: z.string().min(8).max(80).optional(),
    }),
  },
  {
    name: "rms_analytics_snippet",
    cli: ["analytics", "snippet"],
    description: "Return the tracker.js snippet for an existing site id.",
    product: "edgetrack",
    phase: 1,
    billing: "free",
    method: "GET",
    path: "/v1/analytics/sites/{id}/snippet",
    schema: obj({ id }),
  },
  {
    name: "rms_widgets_create",
    cli: ["widgets", "create"],
    description: "Create a Widget Studio embed from caller-supplied data. Review carousels do not add stock avatars or a Verified badge unless requested.",
    product: "widget-studio",
    phase: 1,
    billing: "paid",
    method: "POST",
    path: "/v1/widgets",
    schema: obj({
      type: z.enum(["announcement", "carousel", "player", "counter"]),
      title: z.string().max(160).optional(),
      idempotencyKey: z.string().min(8).max(80).optional(),
      config: z.record(z.string(), z.unknown()),
    }),
  },
  {
    name: "rms_widgets_get",
    cli: ["widgets", "get"],
    description: "Fetch one widget generation owned by the caller.",
    product: "widget-studio",
    phase: 1,
    billing: "free",
    method: "GET",
    path: "/v1/widgets/{id}",
    schema: obj({ id }),
  },
  {
    name: "rms_widgets_embed",
    cli: ["widgets", "embed"],
    description: "Return the embed HTML for a widget.",
    product: "widget-studio",
    phase: 1,
    billing: "free",
    method: "GET",
    path: "/v1/widgets/{id}/embed",
    schema: obj({ id }),
  },
  {
    name: "rms_schema_generate",
    cli: ["schema", "generate"],
    description: "Generate Schema.org JSON-LD for a page. Returns a script tag, not a chat transcript.",
    product: "schema-gen",
    phase: 2,
    billing: "metered",
    method: "POST",
    path: "/v1/schema",
    schema: obj({
      type: z.string().min(1).max(80),
      page: obj({
        title: z.string().max(200).optional(),
        description: z.string().max(500).optional(),
        url: z.string().max(2000).optional(),
      }),
      facts: z.record(z.string(), z.unknown()),
    }),
  },
  {
    name: "rms_meta_generate",
    cli: ["meta", "generate"],
    description: "Generate title, description, and Open Graph meta tags.",
    product: "meta-gen",
    phase: 2,
    billing: "metered",
    method: "POST",
    path: "/v1/meta",
    schema: obj({
      title: z.string().max(200).optional(),
      description: z.string().max(2000).optional(),
      url: z.string().max(2000).optional(),
    }),
  },
  {
    name: "rms_projects_create",
    cli: ["projects", "create"],
    description: "Create an HTML Studio project from a document payload.",
    product: "html-studio",
    phase: 2,
    billing: "free",
    method: "POST",
    path: "/v1/projects",
    schema: obj({
      title: z.string().min(1).max(160),
      idempotencyKey: z.string().min(8).max(80).optional(),
      doc: z.record(z.string(), z.unknown()).optional(),
    }),
  },
  {
    name: "rms_projects_publish",
    cli: ["projects", "publish"],
    description: "Publish an HTML Studio project to a zone slug or attach it to a customer domain.",
    product: "html-studio",
    phase: 2,
    billing: "paid",
    method: "POST",
    path: "/v1/projects/{id}/publish",
    schema: obj({
      id,
      zone: z.string().min(1).max(200),
      slug: z.string().min(1).max(80),
      domain: z.string().max(200).optional(),
      replace: z.boolean().optional(),
    }),
  },
  {
    name: "rms_deploys_create",
    cli: ["deploy"],
    description: "Deploy a static file tree the way the Wrangler CLI does: rms deploy --project-name=<slug> --zone=<zone>.",
    product: "wrangler",
    phase: 2,
    billing: "paid",
    method: "POST",
    path: "/v1/deploys",
    schema: obj({
      projectName: z.string().min(1).max(80),
      zone: z.string().min(1).max(200),
      files: z.array(obj({
        path: z.string().min(1).max(300),
        content: z.string().max(2_000_000),
      })).min(1).max(200),
    }),
  },
  {
    name: "rms_hosting_attach",
    cli: ["hosting", "attach"],
    description: "Point a customer domain at an html_studio or wrangler publish slug. Writes the account DOMAIN_MAP row; rms-hosting only reads it.",
    product: "account",
    phase: 2,
    billing: "free",
    method: "POST",
    path: "/v1/hosting",
    schema: obj({
      domain: z.string().min(1).max(200),
      app: z.enum(["html_studio", "wrangler"]),
      ref: z.string().min(1).max(80),
      replace: z.boolean().optional(),
    }),
  },
];

export function findTool(argv: string[]): { tool: ToolDef; rest: string[] } | null {
  let best: { tool: ToolDef; rest: string[] } | null = null;
  for (const tool of tools) {
    const n = tool.cli.length;
    if (argv.length < n) continue;
    if (tool.cli.every((part, i) => argv[i] === part)) {
      if (!best || n > best.tool.cli.length) best = { tool, rest: argv.slice(n) };
    }
  }
  return best;
}

export function toolByName(name: string): ToolDef | undefined {
  return tools.find((tool) => tool.name === name);
}
