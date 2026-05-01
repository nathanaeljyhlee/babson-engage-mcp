# How to Build an MCP-Powered Copilot Studio Agent on Azure

A step-by-step guide based on the Babson Engage Assistant project. Covers building an MCP server, deploying it as an Azure Function App, connecting it to Microsoft Copilot Studio, and publishing a public-facing agent.

**Author:** Nathanael Lee
**Date:** April 10, 2026
**Context:** Babson AI Fellowship, Spring 2026

---

## Architecture Overview

```
[Data Source]  -->  [MCP Server]  -->  [Azure Function App]  -->  [Copilot Studio Agent]  -->  [User]
  (RSS/API)       (TypeScript)        (Cloud hosting)            (AI orchestration)          (Web chat)
```

The MCP (Model Context Protocol) server wraps external data sources into a standardized tool interface. Azure Function App hosts the MCP server in the cloud. Copilot Studio connects to the MCP as a tool and provides the AI agent layer with natural language understanding, conversation management, and content moderation.

---

## Part 1: Build the MCP Server

### 1.1 Project Setup

```bash
mkdir my-mcp-server && cd my-mcp-server
npm init -y
npm install @modelcontextprotocol/sdk express zod
npm install -D typescript @types/node @types/express tsx
npx tsc --init
```

Set `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true
  }
}
```

Set `package.json` type and scripts:
```json
{
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js",
    "start:http": "node dist/server-http.js",
    "dev": "tsx src/server.ts",
    "dev:http": "tsx src/server-http.ts"
  }
}
```

### 1.2 Create the MCP Server (stdio for local dev)

`src/server.ts` -- standard MCP server using stdio transport:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "my-server", version: "1.0.0" });

// Define tools
server.tool(
  "my-tool",
  "Description of what this tool does",
  { query: z.string().describe("Search query") },
  async ({ query }) => {
    const results = await fetchData(query); // your data fetching logic
    return { content: [{ type: "text", text: JSON.stringify(results) }] };
  }
);

// Start
const transport = new StdioServerTransport();
await server.connect(transport);
```

### 1.3 Add HTTP/SSE Transport (for cloud deployment)

`src/server-http.ts` -- Express server with SSE transport:

```typescript
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

// Health check
app.get("/", (_req, res) => {
  res.json({ name: "my-mcp", version: "1.0.0", status: "ok" });
});

// SSE endpoint
const transports: Record<string, SSEServerTransport> = {};

app.get("/sse", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;
  res.on("close", () => delete transports[transport.sessionId]);
  const server = createServer(); // factory that creates your McpServer with tools
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports[sessionId];
  if (!transport) { res.status(400).json({ error: "Invalid session" }); return; }
  await transport.handlePostMessage(req, res);
});

app.listen(PORT, () => console.log(`MCP server on port ${PORT}`));
```

### 1.4 Test Locally

```bash
# Test stdio (for Claude Code / local MCP clients)
npm run dev

# Test HTTP (for cloud deployment)
npm run dev:http
# Visit http://localhost:3000 to verify health check
```

Add to `.mcp.json` for Claude Code testing:
```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["path/to/dist/server.js"]
    }
  }
}
```

---

## Part 2: Deploy to Azure Function App

### 2.1 Prerequisites

- Azure CLI installed (`az --version`)
- Logged in to Azure (`az login`)
- Access to an Azure subscription (for Babson: "Agentic AI Sandbox" subscription)

### 2.2 Create Azure Resources

```bash
# Set variables
RG="rg-ai-fellowship-projects"    # or your resource group
APP_NAME="my-mcp-server"
LOCATION="canadacentral"           # pick your region

# Create App Service Plan (free tier)
az appservice plan create \
  --name "${APP_NAME}-plan" \
  --resource-group $RG \
  --sku F1 \
  --is-linux

# Create Web App (Node.js)
az webapp create \
  --name $APP_NAME \
  --resource-group $RG \
  --plan "${APP_NAME}-plan" \
  --runtime "NODE:22-lts"
```

### 2.3 Configure the App

```bash
# Set startup command
az webapp config set \
  --name $APP_NAME \
  --resource-group $RG \
  --startup-file "node dist/server-http.js"

# Set environment variables if needed
az webapp config appsettings set \
  --name $APP_NAME \
  --resource-group $RG \
  --settings PORT=8080 MY_API_KEY=xxx
```

### 2.4 Deploy Code

Option A -- ZIP deploy (simplest):
```bash
npm run build
cd dist && zip -r ../deploy.zip . && cd ..
az webapp deploy --name $APP_NAME --resource-group $RG --src-path deploy.zip
```

Option B -- Git deploy:
```bash
az webapp deployment source config-local-git \
  --name $APP_NAME --resource-group $RG
# Push to the git remote it gives you
```

### 2.5 Verify Deployment

```bash
# Check health endpoint
curl https://${APP_NAME}.azurewebsites.net/
# Should return JSON with status: ok
```

---

## Part 3: Connect to Copilot Studio

### 3.1 Create the Agent

1. Go to https://copilotstudio.microsoft.com
2. Create a new agent
3. Set name, description, and instructions
4. Keep generative orchestration ON
5. Keep web browsing OFF (you want the agent grounded in your MCP data)

### 3.2 Add MCP as a Tool

1. Go to **Tools** tab
2. Click **+ Add a tool**
3. Select **Model Context Protocol**
4. Enter your Azure Function App URL: `https://your-app.azurewebsites.net/sse`
5. Name it descriptively (e.g., "Babson-Engage-MCP")
6. Set trigger to **By agent** (the agent decides when to call the tool)
7. Enable the tool

### 3.3 Write Agent Instructions

The instructions tell the agent HOW to use your MCP tools. Be specific:

```
You are [Agent Name], helping users with [purpose].

TOOLS
You have access to these tools via the [MCP Name]:

1. tool-name: What it does. When to use it. What parameters to set.
   - For "this week": set from_date to today, to_date to 7 days ahead
   - Default behavior when no parameters specified

BEHAVIOR
- Always call [tool] with explicit parameters
- Present results in [format]
- If no results, suggest [fallback]
```

Key principles:
- Be explicit about parameter usage (the LLM won't guess well)
- Define fallback behavior for empty results
- Specify response formatting
- Mention data limitations the agent should acknowledge

### 3.4 Set Authentication for Publishing

**Critical step** -- without this, users see "Open connection manager" instead of answers.

1. Go to **Tools** -> click your MCP tool
2. Find the authentication/connection settings
3. Change from **"End user credentials"** to **"Maker credentials"**
4. Authenticate yourself once
5. Now all users use your pre-authorized connection

### 3.5 Add Topic Overrides (for content filter bypass)

Copilot Studio's content moderation may block legitimate queries (parties, mental health, alcohol). Create topic overrides that fire BEFORE the content filter:

1. Go to **Topics** -> **+ New Topic** -> **From blank**
2. Set trigger phrases (the keywords that would get blocked)
3. Add a **Send message** action with a hardcoded helpful response
4. Optionally redirect to generative answers after the initial message

Examples:
- "Social Events" topic: catches "party", "nightlife" -> searches events
- "Wellness" topic: catches "stressed", "counseling" -> shows phone numbers
- "Policies" topic: catches "alcohol policy", "drug policy" -> links to handbook

### 3.6 Publish

1. Click **Publish** (top right)
2. Wait for validation and deployment

### 3.7 Get the Public URL

**Option A -- Demo website** (quick testing):
- Go to **Channels** -> **Demo website**
- Copy the auto-generated URL

**Option B -- Web app channel** (embeddable):
- Go to **Channels** -> **Web app**
- Copy the iframe embed code
- Embed in your own HTML page

**Option C -- Custom landing page** (recommended for demos):
- Build an HTML page with your branding
- Embed the iframe from Option B
- Host on Azure Static Web Apps (free tier):

```bash
az staticwebapp create \
  --name my-agent-demo \
  --resource-group $RG \
  --location "eastus2" \
  --sku Free

# Get deployment token
TOKEN=$(az staticwebapp secrets list --name my-agent-demo --query "properties.apiKey" -o tsv)

# Deploy
npx @azure/static-web-apps-cli deploy ./my-demo-folder \
  --deployment-token $TOKEN --env production
```

---

## Part 4: Testing and Tuning

### 4.1 Eval Strategy

Test the MCP data layer separately from the Copilot Studio agent:

1. **MCP layer**: Call tools directly via Claude Code or scripts. Validates data accuracy.
2. **Agent layer**: Test in Copilot Studio test pane. Validates instruction following.
3. **Published agent**: Test via the public URL. Validates auth, content filters, user experience.

### 4.2 Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| "Open connection manager" | Auth set to end-user | Switch to maker credentials |
| Agent doesn't call MCP tools | Vague instructions | Be explicit about when to call each tool |
| Content filter blocks query | Copilot Studio moderation | Add topic override with trigger phrases |
| Empty results for valid query | Wrong parameters | Add parameter guidance in instructions |
| Too many results | No limit set | Add "cap at N results" in instructions |
| Stale data | Cache TTL too long | Reduce cache TTL in MCP server |

### 4.3 Programmatic Management (Advanced)

You can manage the agent via CLI and API:

```bash
# Install tools
winget install Microsoft.DotNet.SDK.8
dotnet tool install --global Microsoft.PowerApps.CLI.Tool --version 1.32.6

# Authenticate
pac auth create --environment "https://your-org.crm.dynamics.com"

# List agents
pac copilot list

# Extract agent template
pac copilot extract-template --bot <bot-id> --templateFileName template.yaml

# Publish
pac copilot publish --bot <bot-id>
```

Update agent instructions via Dataverse API:
```bash
TOKEN=$(az account get-access-token --resource https://your-org.crm.dynamics.com --query accessToken -o tsv)

# Get component ID
curl "https://your-org.crm.dynamics.com/api/data/v9.2/botcomponents?\$filter=schemaname eq 'your.gpt.default'" \
  -H "Authorization: Bearer $TOKEN"

# Update instructions (PATCH with new data field)
curl -X PATCH "https://your-org.crm.dynamics.com/api/data/v9.2/botcomponents(<component-id>)" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"data": "<new YAML content>"}'
```

Create new topics via Dataverse API:
```bash
curl -X POST "https://your-org.crm.dynamics.com/api/data/v9.2/botcomponents" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Topic",
    "schemaname": "your.topic.MyTopic",
    "componenttype": 9,
    "data": "<AdaptiveDialog YAML>",
    "parentbotid@odata.bind": "/bots(<bot-guid>)"
  }'
```

---

## Part 5: Babson-Specific Notes

### Azure Access
- Student accounts on Babson's Azure tenant cannot create Function Apps by default
- Request access from Phil Ahn or IT -- they need to add you to a subscription with contributor permissions
- The "Agentic AI Sandbox" subscription (ID: 55cf028e-0b45-4737-ac1e-e5e9b1362ef6) has the right permissions

### Copilot Studio Access
- Available at https://copilotstudio.microsoft.com via Babson SSO
- Environment: "Babson College (default)"
- Dataverse org: org9972f205.crm.dynamics.com

### Data Sources Available
- **Babson Engage**: RSS feeds (events, clubs) + iCal (historical) -- public, no auth needed
- **Canvas LMS**: REST API -- requires per-user API token
- **Workday**: No API access currently -- highest demand from GLL
- **Student Portal (intranet.babson.edu)**: Static pages, could be crawled

### Content Moderation
- Copilot Studio blocks queries about alcohol, drugs, mental health, violence
- Topic overrides bypass the filter by intercepting keywords before generative AI processes them
- For a campus bot, set content moderation to Medium if the option is available

---

## Reference Files

- MCP Server source: `engage-mcp-server/src/`
- Agent template: `engage-demo/engage-bot-template-updated.yaml`
- Demo page: `engage-demo/index.html`
- Eval test cases: `engage-demo/eval-test-cases.csv`
- Tuning guide: `engage-demo/COPILOT-TUNING-GUIDE.md`
- Updated instructions: `engage-demo/UPDATED-INSTRUCTIONS.md`
