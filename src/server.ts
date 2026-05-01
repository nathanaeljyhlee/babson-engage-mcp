#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fetchEvents, fetchGroups, fetchPastEvents, type EngageEvent, type ICalEvent } from "./feeds.js";

const server = new McpServer({
  name: "babson-engage",
  version: "2.0.0",
});

// ── Unified event type for merged results ────────────────────────────────────

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
    title: e.title,
    date: e.date,
    time: e.time,
    sortDate: e.sortDate,
    location: e.location,
    group: e.group,
    category: e.category,
    foodProvided: e.foodProvided,
    description: e.description,
    link: e.link,
    source: "rss",
    eventId: e.eventId,
  };
}

function icalToUnified(e: ICalEvent): UnifiedEvent {
  return {
    title: e.title,
    date: e.date,
    time: "",
    sortDate: e.sortDate,
    location: e.location,
    group: e.organizer,
    category: e.category,
    foodProvided: null,
    description: "",
    link: e.link,
    source: "ical",
    eventId: null,
  };
}

async function getAllEvents(): Promise<UnifiedEvent[]> {
  const [rssEvents, icalEvents] = await Promise.all([
    fetchEvents(),
    fetchPastEvents(),
  ]);

  const unified = [
    ...rssEvents.map(rssToUnified),
    ...icalEvents.map(icalToUnified),
  ];

  // Dedupe by title+date (iCal may overlap with RSS for current events)
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

// ── Tools ────────────────────────────────────────────────────────────────────

server.tool(
  "search-events",
  "Search all Babson Engage events (past and upcoming) by keyword, date range, or category. Merges RSS feed (upcoming, detailed) and iCal feed (historical) into one timeline.",
  {
    query: z
      .string()
      .optional()
      .describe("Keyword to search in title, description, location, group"),
    category: z
      .string()
      .optional()
      .describe("Filter by category (CAREER, INDUSTRY, SOCIAL, ENTREPRENEURSHIP, COMMUNITY, CULTURAL, ANNOUNCEMENT, or any iCal category string)"),
    from_date: z
      .string()
      .optional()
      .describe("Start date filter (YYYY-MM-DD). Defaults to 90 days ago."),
    to_date: z
      .string()
      .optional()
      .describe("End date filter (YYYY-MM-DD). Defaults to 30 days ahead."),
    food_only: z
      .boolean()
      .default(false)
      .describe("Only show events with food (RSS events only)"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe("Max events to return"),
  },
  async ({ query, category, from_date, to_date, food_only, limit }) => {
    const all = await getAllEvents();
    const now = new Date();

    const from = from_date
      ? new Date(from_date)
      : new Date(now.getTime() - 90 * 86400000);
    const to = to_date
      ? new Date(to_date + "T23:59:59")
      : new Date(now.getTime() + 30 * 86400000);

    let filtered = all.filter((e) => {
      const d = new Date(e.sortDate);
      return d >= from && d <= to;
    });

    if (query) {
      const q = query.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.location.toLowerCase().includes(q) ||
          e.group.toLowerCase().includes(q)
      );
    }

    if (category) {
      const c = category.toLowerCase();
      filtered = filtered.filter((e) => e.category.toLowerCase().includes(c));
    }

    if (food_only) {
      filtered = filtered.filter((e) => e.foodProvided === true);
    }

    const result = filtered.slice(0, limit);

    if (result.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No events found matching your criteria (${from.toLocaleDateString()} to ${to.toLocaleDateString()}).`,
          },
        ],
      };
    }

    const text = result
      .map((e) => {
        let line = `**${e.title}** (${e.date}${e.time ? " " + e.time : ""})`;
        line += `\n  Location: ${e.location}`;
        line += `\n  Category: ${e.category}`;
        if (e.group) line += ` | Group: ${e.group}`;
        if (e.foodProvided === true) line += ` | Food: Yes`;
        if (e.source === "ical") line += ` | [historical]`;
        if (e.link) line += `\n  Link: ${e.link}`;
        if (e.description) {
          const desc = e.description.slice(0, 120);
          line += `\n  ${desc}${e.description.length > 120 ? "..." : ""}`;
        }
        return line;
      })
      .join("\n\n");

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${result.length} event(s) (${from.toLocaleDateString()} to ${to.toLocaleDateString()}):\n\n${text}`,
        },
      ],
    };
  }
);

server.tool(
  "get-event-detail",
  "Get full details for a specific Babson Engage event by its event ID (RSS events only).",
  {
    event_id: z.string().describe("The Engage event ID"),
  },
  async ({ event_id }) => {
    const events = await fetchEvents();
    const event = events.find((e) => e.eventId === event_id);

    if (!event) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Event with ID "${event_id}" not found. It may have passed or been removed.`,
          },
        ],
      };
    }

    const text =
      `**${event.title}**\n\n` +
      `Event ID: ${event.eventId}\n` +
      `Date: ${event.date}\n` +
      `Time: ${event.time}\n` +
      `Location: ${event.location}\n` +
      `Group: ${event.group}\n` +
      `Category: ${event.category}\n` +
      `Event Type: ${event.eventType}\n` +
      `Food Provided: ${event.foodProvided ? "Yes" : "No"}\n` +
      `Link: ${event.link}\n\n` +
      `Description:\n${event.description}`;

    return {
      content: [{ type: "text" as const, text }],
    };
  }
);

server.tool(
  "list-groups",
  "List active student clubs and organizations on Babson Engage. Optionally filter by type or search by name.",
  {
    search: z
      .string()
      .optional()
      .describe("Filter groups by name keyword"),
    group_type: z
      .string()
      .optional()
      .describe("Filter by group type (e.g., 'Club', 'Organization')"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(30)
      .describe("Max groups to return"),
  },
  async ({ search, group_type, limit }) => {
    const groups = await fetchGroups();

    let filtered = groups;
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (g) =>
          g.name.toLowerCase().includes(q) ||
          g.mission.toLowerCase().includes(q)
      );
    }
    if (group_type) {
      const t = group_type.toLowerCase();
      filtered = filtered.filter((g) => g.groupType.toLowerCase().includes(t));
    }

    const result = filtered.slice(0, limit);

    if (result.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No groups found matching your criteria.",
          },
        ],
      };
    }

    const text = result
      .map(
        (g) =>
          `**${g.name}** (${g.groupType})\n` +
          `  Category: ${g.category}\n` +
          `  ${g.mission}\n` +
          `  ${g.link}`
      )
      .join("\n\n");

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${result.length} group(s):\n\n${text}`,
        },
      ],
    };
  }
);

// ── Resources ────────────────────────────────────────────────────────────────

server.resource(
  "events-snapshot",
  "engage://events",
  { description: "Full snapshot of all upcoming Babson Engage events", mimeType: "application/json" },
  async (uri) => {
    const events = await fetchEvents();
    const now = new Date();
    const upcoming = events.filter((e) => new Date(e.sortDate) >= now);
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(upcoming, null, 2),
        },
      ],
    };
  }
);

server.resource(
  "groups-snapshot",
  "engage://groups",
  { description: "Full snapshot of all active Babson Engage clubs and organizations", mimeType: "application/json" },
  async (uri) => {
    const groups = await fetchGroups();
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(groups, null, 2),
        },
      ],
    };
  }
);

// ── Start ────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Failed to start Babson Engage MCP server:", err);
  process.exit(1);
});
