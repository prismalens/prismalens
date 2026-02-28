---
name: workspace
description: Validate remediation recommendations using workspace tools — test fixes, run suites
---

# Remediation Validation Workspace

Use workspace tools to validate proposed fixes before recommending them.

## Available Tools

- `execute(command)` — Run shell commands (test suites, scripts, git, etc.)
- `grep(pattern, path)` — Search file contents
- `read_file(path)` — Read files
- `write_file(path, content)` — Write test scripts, patches
- `glob(pattern)` — Find files by pattern

## Validation Workflow

### 1. Clone the repository (if not already in workspace)
```
execute("git clone https://github.com/org/repo.git /workspace/repo")
```

### 2. Write a validation script
```
write_file("/workspace/validate-fix.py", """
# Test that the proposed config change resolves the issue
import json
config = json.load(open('/workspace/repo/config.json'))
assert config.get('timeout') is not None, 'timeout must be set'
print('PASS: config validation')
""")
execute("python3 /workspace/validate-fix.py")
```

### 3. Run existing tests
```
execute("cd /workspace/repo && npm test 2>&1 | tail -20")
```

### 4. Apply a patch and verify
```
execute("cd /workspace/repo && git diff HEAD~1 -- src/config.ts")
```

## Best Practices

1. **Test before recommending**: If possible, validate that your fix actually works
2. **Run the test suite**: Check for regressions after applying fixes
3. **Keep scripts focused**: One script per validation, with clear PASS/FAIL output
4. **Document validation**: Note in your recommendation what was validated and how
5. **Time-box validation**: Don't spend too long — a quick sanity check is better than none
