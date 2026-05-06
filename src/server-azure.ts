#!/usr/bin/env node

import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { fetchEvents, fetchGroups, fetchPastEvents, type EngageEvent, type ICalEvent } from "./feeds.js";

// ── API key authentication (optional) ────────────────────────────────────────
// Engage data is public (Babson RSS/iCal feeds), so this server runs without
// auth by default. If MCP_API_KEY is set in env, it is enforced — set it to
// add defense-in-depth and prevent uncontrolled programmatic enumeration.

const MCP_API_KEY = process.env.MCP_API_KEY;
const expectedKeyHash = MCP_API_KEY
  ? crypto.createHash("sha256").update(MCP_API_KEY).digest()
  : null;

if (!MCP_API_KEY) {
  console.warn("MCP_API_KEY not set — running in public mode (no auth on /mcp).");
}

function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  // No key configured = public mode (matches pre-audit behavior)
  if (!expectedKeyHash) {
    next();
    return;
  }
  const key = (req.headers["api-key"] || req.headers["x-api-key"]) as string | undefined;
  if (!key) {
    res.status(401).json({ error: "Invalid or missing API key. Set api-key header." });
    return;
  }
  const providedHash = crypto.createHash("sha256").update(key).digest();
  if (!crypto.timingSafeEqual(providedHash, expectedKeyHash)) {
    res.status(401).json({ error: "Invalid or missing API key. Set api-key header." });
    return;
  }
  next();
}

// ── Unified event type ───────────────────────────────────────────────────────

interface UnifiedEvent {
  title: string;
  date: string;
  time: string;
  sortDate: string;
  location: string;
  group: string;
  category: string;
  foodProvided: boolean | null;
  description: string;
  link: string;
  source: "rss" | "ical";
  eventId: string | null;
}

function rssToUnified(e: EngageEvent): UnifiedEvent {
  return {
    title: e.title, date: e.date, time: e.time, sortDate: e.sortDate,
    location: e.location, group: e.group, category: e.category,
    foodProvided: e.foodProvided, description: e.description,
    link: e.link, source: "rss", eventId: e.eventId,
  };
}

function icalToUnified(e: ICalEvent): UnifiedEvent {
  return {
    title: e.title, date: e.date, time: "", sortDate: e.sortDate,
    location: e.location, group: e.organizer, category: e.category,
    foodProvided: null, description: "", link: e.link,
    source: "ical", eventId: null,
  };
}

async function getAllEvents(): Promise<UnifiedEvent[]> {
  const [rssEvents, icalEvents] = await Promise.all([fetchEvents(), fetchPastEvents()]);
  const unified = [...rssEvents.map(rssToUnified), ...icalEvents.map(icalToUnified)];
  const seen = new Set<string>();
  const deduped: UnifiedEvent[] = [];
  for (const e of unified) {
    const key = `${e.title.toLowerCase()}|${e.sortDate.slice(0, 10)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(e);
  }
  deduped.sort((a, b) => a.sortDate.localeCompare(b.sortDate));
  return deduped;
}

// ── MCP Server factory ───────────────────────────────────────────────────────

function createServer(): McpServer {
  const server = new McpServer({
    name: "babson-engage",
    version: "2.0.0",
  });

  server.tool(
    "search-events",
    "Search all Babson Engage events (past and upcoming) by keyword, date range, or category.",
    {
      query: z.string().optional().describe("Keyword search"),
      category: z.string().optional().describe("Filter by category"),
      from_date: z.string().optional().describe("Start date (YYYY-MM-DD). Default: 90 days ago"),
      to_date: z.string().optional().describe("End date (YYYY-MM-DD). Default: 30 days ahead"),
      food_only: z.boolean().default(false).describe("Only events with the foodProvided flag set. Note: many events with food don't set this flag -- also check event descriptions for food keywords."),
      limit: z.number().int().min(1).max(100).default(20).describe("Max results"),
    },
    async ({ query, category, from_date, to_date, food_only, limit }) => {
      const all = await getAllEvents();
      const now = new Date();
      const from = from_date ? new Date(from_date) : new Date(now.getTime() - 90 * 86400000);
      const to = to_date ? new Date(to_date + "T23:59:59") : new Date(now.getTime() + 30 * 86400000);

      let filtered = all.filter((e) => {
        const d = new Date(e.sortDate);
        return d >= from && d <= to;
      });
      if (query) {
        const q = query.toLowerCase();
        filtered = filtered.filter((e) =>
          e.title.toLowerCase().includes(q) || e.description.toLowerCase().includes(q) ||
          e.location.toLowerCase().includes(q) || e.group.toLowerCase().includes(q));
      }
      if (category) {
        const c = category.toLowerCase();
        filtered = filtered.filter((e) => e.category.toLowerCase().includes(c));
      }
      if (food_only) filtered = filtered.filter((e) => e.foodProvided === true);

      const result = filtered.slice(0, limit);
      if (result.length === 0) {
        return { content: [{ type: "text" as const, text: "No events found." }] };
      }
      const text = result.map((e) => {
        let line = `**${e.title}** (${e.date}${e.time ? " " + e.time : ""})`;
        line += `\n  Location: ${e.location} | Category: ${e.category}`;
        if (e.group) line += ` | Group: ${e.group}`;
        if (e.foodProvided === true) line += ` | Food: Yes`;
        if (e.source === "ical") line += ` | [historical]`;
        if (e.description) {
          const desc = e.description.slice(0, 200);
          line += `\n  Description: ${desc}${e.description.length > 200 ? "..." : ""}`;
        }
        if (e.link) line += `\n  Link: ${e.link}`;
        return line;
      }).join("\n\n");
      return { content: [{ type: "text" as const, text: `Found ${result.length} event(s):\n\n${text}` }] };
    }
  );

  server.tool(
    "get-event-detail",
    "Get full details for a specific event by ID.",
    { event_id: z.string().describe("The Engage event ID") },
    async ({ event_id }) => {
      const events = await fetchEvents();
      const event = events.find((e) => e.eventId === event_id);
      if (!event) {
        return { content: [{ type: "text" as const, text: `Event "${event_id}" not found.` }] };
      }
      const text = `**${event.title}**\n\nEvent ID: ${event.eventId}\nDate: ${event.date}\nTime: ${event.time}\nLocation: ${event.location}\nGroup: ${event.group}\nCategory: ${event.category}\nType: ${event.eventType}\nFood: ${event.foodProvided ? "Yes" : "No"}\nLink: ${event.link}\n\nDescription:\n${event.description}`;
      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "list-groups",
    "List active student clubs and organizations.",
    {
      search: z.string().optional().describe("Keyword filter"),
      group_type: z.string().optional().describe("Filter by type"),
      limit: z.number().int().min(1).max(100).default(30).describe("Max results"),
    },
    async ({ search, group_type, limit }) => {
      const groups = await fetchGroups();
      let filtered = groups;
      if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter((g) => g.name.toLowerCase().includes(q) || g.mission.toLowerCase().includes(q));
      }
      if (group_type) {
        const t = group_type.toLowerCase();
        filtered = filtered.filter((g) => g.groupType.toLowerCase().includes(t));
      }
      const result = filtered.slice(0, limit);
      if (result.length === 0) {
        return { content: [{ type: "text" as const, text: "No groups found." }] };
      }
      const text = result.map((g) => `**${g.name}** (${g.groupType})\n  Category: ${g.category}\n  ${g.mission}\n  ${g.link}`).join("\n\n");
      return { content: [{ type: "text" as const, text: `Found ${result.length} group(s):\n\n${text}` }] };
    }
  );

  return server;
}

// ── Express app with Streamable HTTP transport ──────────────────────────────

const app = express();
// Azure App Service sits behind 1 proxy; trust X-Forwarded-For so req.ip
// resolves to the real client IP for rate limiting and logs.
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "256kb" }));

const mcpLimiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });

const PORT = parseInt(process.env.PORT || process.env.FUNCTIONS_HTTPWORKER_PORT || "8080", 10);

// Session store for Copilot Studio (sends mcp-session-id header)
const sessions = new Map<string, { server: McpServer; transport: StreamableHTTPServerTransport }>();

function generateSessionId(): string {
  return `session-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
}

// Clean up stale sessions after 30 minutes
setInterval(() => {
  // Simple cleanup -- in production you'd track last-access time
  if (sessions.size > 100) {
    const oldest = sessions.keys().next().value;
    if (oldest) {
      const s = sessions.get(oldest);
      s?.transport.close();
      s?.server.close();
      sessions.delete(oldest);
    }
  }
}, 60000);

// Health check
app.get("/", (_req, res) => {
  res.json({
    name: "babson-engage-mcp",
    version: "2.0.0",
    status: "ok",
    transport: "streamable-http",
    endpoint: "/mcp",
    tools: ["search-events", "get-event-detail", "list-groups"],
    activeSessions: sessions.size,
  });
});

// MCP endpoint -- supports sessions for Copilot Studio
app.post("/mcp", requireApiKey, mcpLimiter, async (req: Request, res: Response) => {
  const existingSessionId = req.headers["mcp-session-id"] as string | undefined;

  if (existingSessionId && sessions.has(existingSessionId)) {
    // Reuse existing session
    const { transport } = sessions.get(existingSessionId)!;
    await transport.handleRequest(req, res, req.body);
    return;
  }

  // New session
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: generateSessionId,
  });

  res.on("close", () => {
    const sid = transport.sessionId;
    if (sid && !sessions.has(sid)) {
      transport.close();
      server.close();
    }
  });

  await server.connect(transport);

  // Store session after connect so sessionId is set
  const handleAndStore = async () => {
    await transport.handleRequest(req, res, req.body);
    if (transport.sessionId) {
      sessions.set(transport.sessionId, { server, transport });
    }
  };
  await handleAndStore();
});

// Handle GET for SSE streams on existing sessions
app.get("/mcp", requireApiKey, mcpLimiter, (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (sessionId && sessions.has(sessionId)) {
    const { transport } = sessions.get(sessionId)!;
    transport.handleRequest(req, res);
    return;
  }
  res.status(400).json({ error: "No active session. Send a POST to /mcp first to initialize." });
});

// Handle DELETE to close sessions
app.delete("/mcp", requireApiKey, (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (sessionId && sessions.has(sessionId)) {
    const s = sessions.get(sessionId)!;
    s.transport.close();
    s.server.close();
    sessions.delete(sessionId);
    res.status(200).json({ status: "session closed" });
    return;
  }
  res.status(404).json({ error: "Session not found" });
});

app.listen(PORT, () => {
  console.log(`Babson Engage MCP server running on port ${PORT}`);
  console.log(`  Health:   http://localhost:${PORT}/`);
  console.log(`  MCP:      http://localhost:${PORT}/mcp (POST)`);
});

export default app;
