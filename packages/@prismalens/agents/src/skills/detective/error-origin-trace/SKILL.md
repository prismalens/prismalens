---
name: error-origin-trace
description: Traces an error back to its actual source using MCP-based code analysis. Errors often bubble up and get logged far from their origin.
---

# Error Origin Trace Skill

## Purpose
Errors bubble up through catch blocks and error handlers, getting logged far from their actual source. This skill uses MCP servers to trace back to the ACTUAL origin.

## Available MCP Tools
- `mcp_search_pattern(pattern, directory, fileType)` - Find error patterns across codebase
- `mcp_get_callers(functionName, depth)` - Trace call paths
- `mcp_get_callees(functionName, depth)` - Trace what functions call
- `mcp_search_code_advanced(query, regex, filePattern)` - Find code patterns
- `mcp_find_symbol(symbolName)` - Locate function definitions

## The Error Origin Problem

```
Actual bug:        db/connection.ts:45  → throws ECONNREFUSED
First catch:       db/queries.ts:23    → wraps as "Query failed"
Second catch:      handlers/user.ts:12 → wraps as "User creation failed"
Logged here:       routes/api.ts:8     → logs "API Error: User creation failed"
                   ↑
                   This is what we see, but the bug is 3 layers down
```

## Process

### 1. Extract Error Signature
From logs/alerts, extract:
- Error message text
- Error type/class (e.g., `TypeError`, `ConnectionError`)
- Stack trace (if available)
- Error code (e.g., `ECONNREFUSED`, `ENOENT`)

### 2. Search for Error Origin
Use `mcp_search_pattern` to find:

```
# Find where error is actually thrown
pattern: "throw.*ECONNREFUSED" OR "new Error.*ECONNREFUSED"

# Find all error handlers
pattern: "catch.*Error"

# Find error wrapper patterns
pattern: "throw new.*from.*error"
```

### 3. Build Error Propagation Chain
For each potential origin:
1. Use `mcp_get_callers` to trace how it propagates up
2. Map the catch-rethrow chain
3. Identify where original error info is lost

### 4. Analyze Try-Catch Blocks
Use `mcp_search_code_advanced` to find:
- Try-catch blocks in the call path
- Error transformation patterns
- Where stack traces are dropped

### 5. Identify Likely Origin
Score potential origins:

| Evidence | Score |
|----------|-------|
| Throws exact error message | +40 |
| On call path from logged error | +30 |
| Makes external calls (DB, API) | +20 |
| Has been recently modified | +10 |
| Error code matches (ECONNREFUSED) | +30 |

## Output Format

```json
{
  "errorAsLogged": {
    "message": "API Error: User creation failed",
    "location": "routes/api.ts:8",
    "type": "Error"
  },
  "errorPropagationChain": [
    {
      "file": "routes/api.ts",
      "line": 8,
      "action": "logged",
      "originalErrorPreserved": false
    },
    {
      "file": "handlers/user.ts",
      "line": 12,
      "action": "caught_rethrown",
      "transformation": "wrapped as 'User creation failed'"
    },
    {
      "file": "db/queries.ts",
      "line": 23,
      "action": "caught_rethrown",
      "transformation": "wrapped as 'Query failed'"
    },
    {
      "file": "db/connection.ts",
      "line": 45,
      "action": "thrown",
      "originalError": "ECONNREFUSED"
    }
  ],
  "likelyOrigin": {
    "file": "db/connection.ts",
    "function": "getConnection",
    "line": 45,
    "confidence": 90,
    "evidence": [
      "Throws ECONNREFUSED which matches original error",
      "Makes database connection calls",
      "Is in the call path from logged error"
    ]
  },
  "investigationNotes": [
    "Original stack trace lost at handlers/user.ts:12",
    "Consider adding error cause chain (Error.cause)",
    "Database connection config at db/connection.ts:10 may have wrong host"
  ]
}
```

## Common Patterns to Search

### Finding Original Throws
```
pattern: "throw new (Error|TypeError|ConnectionError)"
```

### Finding Catch-Rethrow
```
pattern: "catch.*throw new"
regex: true
```

### Finding Error Wrapping
```
pattern: "new Error.*cause|from.*error"
regex: true
```

### Finding External Call Failures
```
pattern: "(fetch|axios|http|database|connection).*catch"
regex: true
```

## Best Practices

1. **Follow the Stack**: If you have a stack trace, use it as the primary guide
2. **Error Codes Matter**: System error codes (ECONNREFUSED) rarely change
3. **Check Transformations**: Where is error info being lost?
4. **External Boundaries**: Errors often originate at system boundaries
5. **Time Correlation**: Check if origin file was recently changed
