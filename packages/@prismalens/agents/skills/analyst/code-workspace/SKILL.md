---
name: code-workspace
description: Code investigation using workspace tools — clone repos, search code, run analysis scripts
---

# Code Investigation Workspace

Use workspace tools to investigate code-level root causes.

## Available Tools

- `execute(command)` — Run shell commands (git, python3, node, grep, etc.)
- `grep(pattern, path)` — Search file contents with regex
- `read_file(path)` — Read file contents
- `write_file(path, content)` — Write files (scripts, configs)
- `glob(pattern)` — Find files by pattern

## Common Workflows

### Clone a repository
```
execute("git clone https://github.com/org/repo.git /workspace/repo")
```

### Search for error patterns
```
grep("ConnectionTimeout|ECONNREFUSED", "/workspace/repo/src")
```

### Read suspicious files
```
read_file("/workspace/repo/src/config/database.ts")
```

### Write and run an analysis script
```
write_file("/workspace/analyze.py", "import json\n...")
execute("python3 /workspace/analyze.py")
```

## Best Practices

1. **Clone first**: If you need to search code, clone the repo into `/workspace/`
2. **Grep broadly, then narrow**: Start with broad error strings, then drill into specific files
3. **Use scripts for batch work**: Write Python/Node scripts for operations that would take many tool calls
4. **Keep output small**: Scripts should filter/aggregate results, not dump raw data
5. **Mark evidence**: Findings from tool use are `verified: true` — more valuable than reasoning alone

## Script Templates

Check the gatherer's skill directories for reusable script templates:
```
ls("/skills/gatherer/")
```
