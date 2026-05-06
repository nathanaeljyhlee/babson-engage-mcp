# Security Policy

## Scope

This security policy applies to the `babson-engage-mcp` MCP server, which exposes Babson Engage event and group data to AI agents (Microsoft Copilot Studio). It fetches publicly available RSS/iCal feeds — no personal or FERPA-covered data is handled.

## Supported Versions

Only the latest deployed version on Azure App Service is actively maintained.

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Report security issues directly to:
- Nathanael Lee (Babson AI Fellow): nlee2@babson.edu
- Phil Ahn (Babson AI Strategy): via Babson internal channels

Include:
1. Description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Any suggested remediation

You will receive acknowledgment within 2 business days.

## Data Handling

- All data sourced from public Babson Engage RSS and iCal feeds
- No user data, tokens, or credentials are stored or processed
- Feed data is cached in memory for 5 minutes to reduce upstream requests

## Deployment Notes

- The server runs in public mode by default (no auth on `/mcp`). To enable authentication, set `MCP_API_KEY` in Azure App Service Configuration; the middleware will then require the `api-key` (or `x-api-key`) header on all `/mcp` requests.
- Other security hardening — rate limiting, helmet headers, body size limit, trust-proxy, non-root container — is always active.
- The server is intended for use within the Babson College Azure tenant.
