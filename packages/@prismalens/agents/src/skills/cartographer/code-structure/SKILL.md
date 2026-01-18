---
name: code-structure
description: Analyzes code structure using AST-based tools to find function definitions, usages, and patterns across the codebase.
---

# Code Structure Analysis Skill

## Purpose
Use AST-based code analysis to understand code structure, find function usages, and identify patterns that might be related to the incident.

## Available MCP Tools
- `mcp_search_code_advanced(query, regex, filePattern)` - Smart code search with AST awareness
- `mcp_get_file_summary(filePath)` - Analyze file structure: functions, imports, complexity
- `mcp_build_deep_index(path)` - Build full symbol index for comprehensive search
- `mcp_search_pattern(pattern, directory, fileType)` - Fast regex search via ripgrep

## Process

### 1. Understand Error Context
- Extract function/class names from error messages
- Identify relevant file patterns (e.g., "*.controller.ts")

### 2. Find Definitions
Use `mcp_search_code_advanced` to locate:
- Function definitions
- Class definitions
- Interface/type definitions
- Variable declarations

### 3. Analyze File Structure
Use `mcp_get_file_summary` for:
- List of functions and their signatures
- Import statements (dependencies)
- Export statements (what's exposed)
- Complexity indicators

### 4. Pattern Search
Use `mcp_search_pattern` for:
- Error message strings
- Configuration keys
- API endpoints
- Environment variable names

### 5. Cross-Reference Usages
Find how functions/classes are used:
- Constructor calls
- Method invocations
- Type assertions

## Output Format

Return analysis as structured summary:

```json
{
  "targetSymbol": "UserService",
  "definition": {
    "file": "src/services/user.service.ts",
    "line": 15,
    "type": "class",
    "exports": ["UserService", "UserServiceConfig"]
  },
  "structure": {
    "methods": [
      {
        "name": "createUser",
        "line": 25,
        "params": ["email: string", "name: string"],
        "returns": "Promise<User>",
        "async": true
      }
    ],
    "dependencies": [
      "src/db/connection.ts",
      "src/utils/validation.ts"
    ],
    "complexity": "medium"
  },
  "usages": [
    {
      "file": "src/handlers/user.ts",
      "line": 12,
      "context": "new UserService(config)"
    }
  ],
  "relatedPatterns": [
    {
      "pattern": "ECONNREFUSED",
      "occurrences": [
        {
          "file": "src/db/connection.ts",
          "line": 45,
          "context": "catch (e) { log('ECONNREFUSED') }"
        }
      ]
    }
  ]
}
```

## Search Query Examples

### Finding Function Definitions
```
query: "function createUser" OR "createUser = ("
filePattern: "*.ts"
```

### Finding Error Handlers
```
query: "catch.*Error"
regex: true
filePattern: "*.ts"
```

### Finding Config Usage
```
query: "process.env.DATABASE"
filePattern: "*.ts"
```

### Finding Type Usages
```
query: "as UserConfig"
filePattern: "*.ts"
```

## Best Practices

1. **Start Broad, Then Narrow**: Use file patterns to scope searches
2. **Use Regex Carefully**: Powerful but can be slow - use file filters
3. **Check Exports**: Public API surface is more likely to be called incorrectly
4. **Note Async Code**: Promise chains and async/await need special attention
5. **Combine Tools**: Use summary for overview, search for specific patterns
