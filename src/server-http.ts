#!/usr/bin/env node

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { fetchEvents, fetchGroups, fetchPastEvents, type EngageEvent, type ICalEvent } from "./feeds.js";

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
      food_only: z.boolean().default(false).describe("Only events with food"),
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

  server.resource("events-snapshot", "engage://events",
    { description: "Full snapshot of upcoming events", mimeType: "application/json" },
    async (uri) => {
      const events = await fetchEvents();
      const upcoming = events.filter((e) => new Date(e.sortDate) >= new Date());
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(upcoming, null, 2) }] };
    }
  );

  server.resource("groups-snapshot", "engage://groups",
    { description: "Full snapshot of active groups", mimeType: "application/json" },
    async (uri) => {
      const groups = await fetchGroups();
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(groups, null, 2) }] };
    }
  );

  return server;
}

// ── HTTP Server with SSE transport ───────────────────────────────────────────

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

// Health check
app.get("/", (_req, res) => {
  res.json({
    name: "babson-engage-mcp",
    version: "2.0.0",
    status: "ok",
    tools: ["search-events", "get-event-detail", "list-groups"],
    resources: ["engage://events", "engage://groups"],
    docs: "GET /sse to connect via MCP SSE transport",
  });
});

// SSE endpoint -- each connection gets its own MCP server instance
const transports: Record<string, SSEServerTransport> = {};

app.get("/sse", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;

  res.on("close", () => {
    delete transports[transport.sessionId];
  });

  const server = createServer();
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports[sessionId];
  if (!transport) {
    res.status(400).json({ error: "Invalid session ID" });
    return;
  }
  await transport.handlePostMessage(req, res);
});

app.listen(PORT, () => {
  console.log(`Babson Engage MCP server (HTTP/SSE) running on port ${PORT}`);
  console.log(`  Health: http://localhost:${PORT}/`);
  console.log(`  SSE:    http://localhost:${PORT}/sse`);
});
