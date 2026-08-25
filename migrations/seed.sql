-- Demo seed data for Cloudflare MCP Workspace
-- Run after migrations: wrangler d1 execute knowledge --local --file=./migrations/seed.sql

INSERT OR IGNORE INTO notes (id, title, content, tags, user_id) VALUES
  (
    'note-demo-001',
    'Welcome to Cloudflare MCP Workspace',
    'This is a production-ready remote MCP server running on Cloudflare Workers.

It integrates D1, KV, R2, Workers AI, and Vectorize to give LLMs a real knowledge workspace.

Try the tools:
- notes_list / notes_create / notes_search
- ai_summarize / ai_generate
- r2_list / r2_put
- vector_semantic_search
',
    '["welcome","demo","mcp"]',
    NULL
  ),
  (
    'note-demo-002',
    'Architecture Overview',
    'Stateless MCP server using createMcpHandler from the Agents SDK.
Each request creates a fresh McpServer instance.
Bindings (DB, KV, R2, AI, VECTORIZE) are closed over from the Worker env.

Optional Durable Objects can be added later for long-running sessions.',
    '["architecture","cloudflare","agents-sdk"]',
    NULL
  ),
  (
    'note-demo-003',
    'MCP 2026-07-28 Spec',
    'The server implements the latest MCP specification (stateless by default, Streamable HTTP transport).
Tools, resources, and prompts are registered with Zod schemas for strong typing and validation.',
    '["mcp","specification","protocol"]',
    NULL
  );

INSERT OR IGNORE INTO documents (id, key, filename, mime_type, size_bytes, description) VALUES
  (
    'doc-demo-001',
    'demo/readme.md',
    'readme.md',
    'text/markdown',
    512,
    'Placeholder document metadata. Upload real files via the r2_put tool.'
  );
