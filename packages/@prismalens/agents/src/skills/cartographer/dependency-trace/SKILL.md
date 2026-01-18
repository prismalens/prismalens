---
name: dependency-trace
description: Traces file dependencies to find related code that might be the actual error source using MCP code analysis tools.
---

# Dependency Trace Skill

## Purpose
When an error is logged in file A, the actual bug might be in a dependency (file B, C, or D). This skill uses MCP-based code analysis to trace dependencies bidirectionally.

## Available MCP Tools
- `mcp_get_callers(functionName, depth)` - Find all functions that call this function (reverse call graph)
- `mcp_get_callees(functionName, depth)` - Find all functions this function calls (forward call graph)
- `mcp_find_symbol(symbolName)` - Locate a function, class, or symbol in the codebase
- `mcp_resolve_import(importPath, fromFile)` - Resolve import paths to actual file locations
- `mcp_get_file_summary(filePath)` - Analyze file structure: functions, imports, complexity

## Process

### 1. Identify Error Location
- Get the file and function where the error was logged
- Note the error type (thrown, logged, bubbled up)

### 2. Trace Upstream Dependencies (What Calls This?)
Use `mcp_get_callers` to find:
- Direct callers of the error-throwing function
- Callers 2-3 levels up (errors often bubble through layers)
- Entry points (API handlers, event listeners)

### 3. Trace Downstream Dependencies (What Does This Call?)
Use `mcp_get_callees` to find:
- Functions that might be the actual source
- External API calls, database operations
- Utility functions with edge cases

### 4. Analyze Import Chain
Use `mcp_resolve_import` to:
- Follow import/require chains
- Identify circular dependencies
- Map module boundaries

### 5. Score Files by Relevance
Prioritize files for investigation:

| Score | Criteria |
|-------|----------|
| High  | Direct caller/callee of error location |
| High  | Contains similar error handling |
| Medium | Part of same module/feature |
| Medium | Recently changed (check with git tools) |
| Low   | Utility/shared code |

## Output Format

Return findings as structured summary:

```json
{
  "errorLocation": {
    "file": "src/handlers/user.ts",
    "function": "createUser",
    "line": 45
  },
  "callGraph": {
    "upstream": [
      {
        "file": "src/routes/api.ts",
        "function": "handleUserCreate",
        "relationship": "direct_caller"
      }
    ],
    "downstream": [
      {
        "file": "src/db/queries.ts",
        "function": "insertUser",
        "relationship": "direct_callee",
        "relevanceScore": "high",
        "reason": "Database operation that might throw"
      }
    ]
  },
  "suspectedOrigins": [
    {
      "file": "src/db/connection.ts",
      "function": "getConnection",
      "confidence": 75,
      "evidence": "ECONNREFUSED pattern matches DB connection"
    }
  ],
  "investigationPath": [
    "1. Check db/connection.ts:getConnection for connection config",
    "2. Check db/queries.ts:insertUser for query issues",
    "3. Review error handling in handlers/user.ts"
  ]
}
```

## Best Practices

1. **Follow the Error Flow**: Errors bubble UP, bugs live DOWN
2. **Check Depth 2-3**: Most bugs are 2-3 calls away from where they're caught
3. **Note Async Boundaries**: Promises and callbacks obscure call paths
4. **Cross-Reference**: Use with recent-commits to see if callers changed
5. **Don't Go Too Deep**: Limit depth to avoid noise from utility functions
