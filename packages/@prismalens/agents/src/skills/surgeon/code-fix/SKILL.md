---
name: code-fix
description: Proposes specific code changes with search/replace blocks to fix identified bugs and issues.
---

# Code Fix Skill

## Purpose
Create precise, minimal code changes to fix identified bugs. Produces search/replace blocks that can be reviewed and applied by humans.

## Available Tools
- `propose_fix(recommendation)` - Submit a fix proposal with code changes

## Process

### 1. Understand the Bug
From Detective's hypothesis:
- What is the exact error?
- Where does it occur?
- What condition triggers it?

### 2. Locate the Code
From Gatherer's findings:
- File path and line numbers
- Surrounding context
- Related functions

### 3. Design the Fix
Consider:
- Minimal change principle
- Side effects
- Edge cases
- Backward compatibility

### 4. Create Search/Replace Block
- `searchBlock`: EXACT current code (copy-paste)
- `replaceBlock`: Your corrected version
- Include enough context for unique matching

## Output Format

Use `propose_fix` with:

```json
{
  "type": "code_fix",
  "title": "Fix null pointer in auth handler",
  "priority": "critical|high|medium|low",
  "description": "Add null check before accessing user properties",
  "rootCauseLink": "Addresses hypothesis H1: missing null check",
  "codeChanges": [
    {
      "file": "src/auth/handler.ts",
      "searchBlock": "const userName = user.name;",
      "replaceBlock": "const userName = user?.name ?? 'Anonymous';",
      "explanation": "Added optional chaining and default value"
    }
  ],
  "testCase": {
    "description": "Verify fix handles anonymous users",
    "steps": [
      "Clear session/logout",
      "Access protected endpoint without auth",
      "Verify no NullPointerException",
      "Verify appropriate error response"
    ],
    "expectedOutcome": "Returns 401 Unauthorized instead of 500 error"
  },
  "risks": [
    {
      "risk": "May change behavior for legitimate null cases",
      "mitigation": "Default to 'Anonymous' is safe fallback"
    }
  ],
  "rollbackPlan": "Revert commit or redeploy previous version"
}
```

## Fix Patterns

### Null Check Addition
```typescript
// Before
const value = object.property;

// After
const value = object?.property ?? defaultValue;
// OR
if (!object) {
  throw new AppError('Object is required');
}
const value = object.property;
```

### Error Handling
```typescript
// Before
const result = await riskyOperation();

// After
try {
  const result = await riskyOperation();
} catch (error) {
  logger.error('Operation failed', { error });
  throw new AppError('Operation failed', { cause: error });
}
```

### Type Guard
```typescript
// Before
function process(input: any) {
  return input.value;
}

// After
function process(input: unknown) {
  if (!isValidInput(input)) {
    throw new ValidationError('Invalid input');
  }
  return input.value;
}
```

## Priority Guidelines

| Priority | Criteria |
|----------|----------|
| critical | Production down, data loss, security issue |
| high     | Major feature broken, significant user impact |
| medium   | Degraded functionality, workaround exists |
| low      | Minor issue, edge case, cosmetic |

## Best Practices

1. **Exact Match**: searchBlock must match EXACTLY including whitespace
2. **Minimal Change**: Only change what's necessary to fix the bug
3. **Context**: Include enough surrounding lines for unique match
4. **Explanation**: Document WHY the change fixes the issue
5. **Test Cases**: Always provide verification steps
6. **Consider Alternatives**: Note if other approaches exist
7. **No Feature Creep**: Don't add improvements beyond the fix
