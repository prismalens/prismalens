---
name: knowledge-search
description: Search organizational knowledge for evidence to support or contradict hypotheses.
capability: knowledge-retrieval
integrations:
  - confluence
  - jira
  - rag
---

# Knowledge Search Skill

## Purpose
Find relevant documentation, past incidents, and known issues to provide evidence-based challenges to hypotheses.

## Tool Resolution

This skill uses the **knowledge-retrieval** capability which resolves to available tools based on user's integrations:

| Integration | Tool Available | Description |
|-------------|----------------|-------------|
| Confluence (RAG) | `rag_search_knowledge` | Vector search of indexed Confluence docs |
| Confluence (MCP) | `mcp_confluence_search` | Direct MCP server search |
| Jira (RAG) | `rag_search_knowledge` | Vector search of indexed Jira issues |
| Jira (MCP) | `mcp_jira_search` | Direct MCP server search |
| None | `pattern_match` | Built-in pattern matching (always available) |

## Available Tools (Fallback)

When no RAG or MCP integrations are available, use:

- `pattern_match(text, categories?)` - Match against known incident patterns

## Process

### 1. Extract Search Terms
From the hypothesis, identify key terms:

```
Hypothesis: "Database connection pool exhaustion caused API timeouts"

Search terms:
- "connection pool exhaustion"
- "database timeout"
- "API timeout database"
- "connection limit"
```

### 2. Search for Contradicting Evidence
Look for cases where similar symptoms had different causes:

```json
{
  "query": "API timeout NOT database",
  "purpose": "Find cases where API timeouts were NOT database-related"
}
```

### 3. Search for Supporting Evidence
Validate the hypothesis with historical data:

```json
{
  "query": "connection pool exhaustion resolution",
  "purpose": "Find how past connection pool issues were resolved"
}
```

### 4. Find Similar Incidents
Search for historically similar cases:

```json
{
  "query": "database timeout incident postmortem",
  "purpose": "Learn from past similar incidents"
}
```

## Using Pattern Match (Always Available)

When no external knowledge sources are configured, use built-in patterns:

```
pattern_match({
  text: "Connection timed out after 30000ms",
  categories: ["database", "network"]
})
```

This searches against known patterns for:
- **database**: Connection pools, deadlocks, migrations
- **kubernetes**: OOM, CrashLoopBackOff, evictions
- **network**: Timeouts, SSL/TLS, connectivity
- **memory**: Heap, GC, memory leaks

## Output Integration

When evidence is found, include it in challenges:

```json
{
  "type": "alternative",
  "description": "Past incident INC-456 showed similar symptoms from network issues",
  "evidence": "Postmortem from 2024-01 documented API timeouts caused by firewall rule change",
  "source": "confluence"
}
```

## Search Strategies

### For High-Confidence Hypotheses
Focus on contradicting evidence:
- "X failure NOT caused by Y"
- "alternative causes for X"
- "false positive X diagnosis"

### For Thin-Evidence Hypotheses
Focus on supporting/validating evidence:
- "how to verify X"
- "symptoms of X"
- "diagnostic steps X"

### For Recurring Issues
Focus on patterns:
- "recurring X issue"
- "X pattern detection"
- "X monitoring improvement"

## Best Practices

1. **Multiple Queries**: Try different phrasings
2. **Balance**: Search for both supporting and contradicting evidence
3. **Recency**: Prioritize recent documentation
4. **Relevance**: Filter results by service/team when possible
5. **Citation**: Always note the source of evidence

## Limitations

- RAG search depends on indexed content quality
- MCP search depends on server availability
- Pattern match is limited to built-in patterns
- No tool provides real-time metrics (use Cartographer for that)
