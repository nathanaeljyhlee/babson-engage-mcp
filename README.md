# Babson Engage MCP Server

MCP server that gives AI agents access to Babson's campus events and student organizations via Babson Engage (powered by CampusGroups/Anthology). Merges live RSS feeds with historical iCal data into one unified, searchable timeline of 150+ events.

Built for the Babson AI Fellowship (Spring 2026) as infrastructure for the May 4 deliverable: demonstrating how internal Babson data sources can be turned into MCP-compatible data layers for AI agents like NavAI.

## Live Deployment

| Component | URL |
|---|---|
| Production MCP endpoint (Azure App Service) | `https://babson-engage-mcp.azurewebsites.net` |
| Live demo (Azure Static Web Apps) | `http://ambitious-sky-0c81b370f.1.azurestaticapps.net/` |

Both currently deploy via manual `deploy.zip` upload. See "Migrating to GitHub Actions" below for the IT-handoff guide on switching to push-to-deploy.

## Data Sources

| Source | URL | What it provides |
|---|---|---|
| Events RSS | `https://engage.babson.edu/rss_events` | Upcoming events with full detail (description, food, group, location, event type) |
| Groups RSS | `https://engage.babson.edu/rss_groups` | Active student clubs and organizations (68 groups) |
| iCal Feed | `https://engage.babson.edu/ical/babsongrad/ical_babsongrad.ics` | Historical events (past + scheduled, less detail than RSS) |

All three are public endpoints -- no authentication required.

## Tools

### `search-events`
Unified search across all Babson Engage events (past and upcoming). Merges RSS + iCal feeds, deduplicates, and returns a sorted timeline.

**Parameters:**
- `query` (optional) -- Keyword search across title, description, location, group
- `category` (optional) -- Filter by category (CAREER, INDUSTRY, SOCIAL, ENTREPRENEURSHIP, COMMUNITY, CULTURAL, ANNOUNCEMENT)
- `from_date` (optional) -- Start date (YYYY-MM-DD). Default: 90 days ago
- `to_date` (optional) -- End date (YYYY-MM-DD). Default: 30 days ahead
- `food_only` (optional) -- Only events with food provided
- `limit` (optional) -- Max results (default 20, max 100)

### `get-event-detail`
Full details for a specific event by its Engage event ID. RSS events only (upcoming events have richer data than iCal historical records).

**Parameters:**
- `event_id` -- The Engage event ID

### `list-groups`
List active student clubs and organizations. Filter by name/mission keyword or group type.

**Parameters:**
- `search` (optional) -- Keyword filter on name or mission
- `group_type` (optional) -- Filter by type (e.g., "Graduate Club", "Organization")
- `limit` (optional) -- Max results (default 30, max 100)

## Resources

- `engage://events` -- Full JSON snapshot of all upcoming events
- `engage://groups` -- Full JSON snapshot of all active groups

## Architecture

- **Caching:** In-memory cache with 5-minute TTL. Stale fallback if RSS/iCal is unreachable.
- **Deduplication:** Events appearing in both RSS and iCal are merged by title + date, preferring the richer RSS record.
- **Category mapping:** 18 CampusGroups event types mapped to 7 categories for consistent filtering.
- **Transport:** Stdio (standard MCP). Runs as a local process managed by Claude Code.

## Setup

```bash
npm install
npm run build
```

## Usage with Claude Code

Add to `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "babson-engage": {
      "command": "node",
      "args": ["/path/to/engage-mcp-server/dist/server.js"]
    }
  }
}
```

## Development

```bash
npm run dev  # runs with tsx
```

## Example Queries

- "What career events are happening this week?" -- `search-events(category: "CAREER", from_date: "2026-04-07", to_date: "2026-04-14")`
- "Any events with free food?" -- `search-events(food_only: true)`
- "What happened at Babson in February?" -- `search-events(from_date: "2026-02-01", to_date: "2026-02-28")`
- "Find tech clubs" -- `list-groups(search: "tech")`

## Tech Stack

- TypeScript + Node.js
- `@modelcontextprotocol/sdk` -- MCP server framework
- `fast-xml-parser` -- RSS/XML parsing
- `zod` -- Input validation

## Migrating to GitHub Actions (IT Handoff Guide)

Today both the MCP server and the demo deploy via manual `deploy.zip` upload to Azure. The repo contains two ready-to-go GitHub Actions workflows in `.github/workflows/`, shipped with `.example` extensions so they're inert until activated.

### Activate MCP server auto-deploy (Azure App Service)

1. **Get the publish profile.** Azure Portal → App Service `babson-engage-mcp` → Overview → "Get publish profile" (downloads `.PublishSettings` XML).
2. **Add to GitHub.** Repo → Settings → Secrets and variables → Actions → New repository secret named `AZURE_WEBAPP_PUBLISH_PROFILE`. Paste the entire XML contents.
3. **Activate the workflow.** Rename `.github/workflows/azure-app-service-deploy.yml.example` → `.github/workflows/azure-app-service-deploy.yml` and commit. Every push to `main` will now build and deploy the MCP server.

### Activate demo auto-deploy (Azure Static Web Apps)

1. **Get the deployment token.** Azure Portal → Static Web App for the demo → "Manage deployment token" → copy.
2. **Add to GitHub.** Repo → Settings → Secrets → new repo secret named `AZURE_STATIC_WEB_APPS_API_TOKEN`. Paste the token.
3. **Activate the workflow.** Rename `.github/workflows/azure-static-web-app-deploy.yml.example` → `.github/workflows/azure-static-web-app-deploy.yml` and commit. Pushes that touch `demo/**` will redeploy the demo.

After activation: ~5 min per push for the MCP server, ~30 sec for the demo. The manual `deploy.zip` step retires.

### Custom domain (optional, requires Babson IT)

The Azure URLs above are auto-generated. If Babson IT wants `engage-mcp.babson.edu` (or similar), it's a 5-min setup:
1. IT adds a CNAME record from `engage-mcp.babson.edu` to `babson-engage-mcp.azurewebsites.net`
2. In Azure Portal → App Service → Custom domains → "Add custom domain" → verify CNAME, attach a free Azure-managed cert.
Same pattern for the Static Web App demo.
