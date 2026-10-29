import { findTool, tools, type ToolDef } from "./catalog.ts";
import { envFromProcess, RmsClient } from "./client.ts";

type ParsedArgs = {
  help: boolean;
  json: boolean;
  values: Record<string, unknown>;
};

function kebabToCamel(value: string): string {
  return value.replace(/-([a-z])/g, (_m, ch: string) => ch.toUpperCase());
}

function parseArgs(argv: string[]): ParsedArgs {
  const values: Record<string, unknown> = {};
  let help = false;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      help = true;
      continue;
    }
    if (token === "--json") {
      json = true;
      continue;
    }
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument ${token}`);
    }
    const raw = token.slice(2);
    const eq = raw.indexOf("=");
    const key = kebabToCamel(eq === -1 ? raw : raw.slice(0, eq));
    let value: string;
    if (eq !== -1) value = raw.slice(eq + 1);
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
      value = argv[i + 1];
      i += 1;
    } else value = "true";
    assign(values, key, coerce(value));
  }
  return { help, json, values };
}

function assign(target: Record<string, unknown>, key: string, value: unknown) {
  const existing = target[key];
  if (existing == null) {
    target[key] = value;
    return;
  }
  const list = Array.isArray(existing) ? existing : [existing];
  list.push(value);
  target[key] = list;
}

function coerce(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if ((value.startsWith("{") && value.endsWith("}")) || (value.startsWith("[") && value.endsWith("]"))) {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }
  return value;
}

function helpText(): string {
  const lines = [
    "rms — RegisterMySite platform CLI (scaffold)",
    "",
    "This build prints the REST call it would make and does not contact the product workers.",
    "Design: docs/rms-platform-api.md",
    "",
    "Commands:",
  ];
  for (const tool of tools) {
    lines.push(`  rms ${tool.cli.join(" ")}`.padEnd(36) + tool.description);
  }
  lines.push("");
  lines.push("  rms catalog                     Machine-readable tool list");
  lines.push("");
  lines.push("Flags use the tool's JSON fields in kebab-case (--project-name, --destination-email).");
  lines.push("Repeat a flag to pass an array. Pass objects and arrays as JSON.");
  return lines.join("\n");
}

function catalogPayload() {
  return {
    ok: true,
    implemented: false,
    tools: tools.map((tool) => ({
      name: tool.name,
      cli: `rms ${tool.cli.join(" ")}`,
      description: tool.description,
      product: tool.product,
      phase: tool.phase,
      billing: tool.billing,
      method: tool.method,
      path: tool.path,
    })),
  };
}

export async function run(argv: string[], env = envFromProcess()): Promise<{ code: number; stdout: string; stderr: string }> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
    return { code: 0, stdout: `${helpText()}\n`, stderr: "" };
  }
  if (argv[0] === "catalog") {
    return { code: 0, stdout: `${JSON.stringify(catalogPayload(), null, 2)}\n`, stderr: "" };
  }
  const match = findTool(argv);
  if (!match) {
    return { code: 1, stdout: "", stderr: `Unknown command. Run: rms help\n` };
  }
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(match.rest);
  } catch (err) {
    return { code: 1, stdout: "", stderr: `${err instanceof Error ? err.message : String(err)}\n` };
  }
  if (parsed.help) {
    return { code: 0, stdout: `${match.tool.name}  ${match.tool.method} ${match.tool.path}\n${match.tool.description}\n`, stderr: "" };
  }
  const checked = match.tool.schema.safeParse(parsed.values);
  if (!checked.success) {
    return {
      code: 1,
      stdout: "",
      stderr: `${JSON.stringify({ ok: false, code: "invalid_arguments", tool: match.tool.name, issues: checked.error.issues }, null, 2)}\n`,
    };
  }
  const client = new RmsClient(env);
  try {
    const result = await client.invoke(match.tool, checked.data as Record<string, unknown>);
    return { code: 2, stdout: `${JSON.stringify(result, null, 2)}\n`, stderr: "" };
  } catch (err) {
    return { code: 1, stdout: "", stderr: `${err instanceof Error ? err.message : String(err)}\n` };
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1] || "";
  return entry.endsWith("/cli.ts") || entry.endsWith("\\cli.ts");
}

if (isDirectRun()) {
  run(process.argv.slice(2)).then((result) => {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exitCode = result.code;
  });
}

export type { ToolDef };
