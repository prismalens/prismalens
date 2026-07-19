---
"prismalens": minor
"@prismalens/config": minor
---

CLI UX fixes (issue #179): the storage directory is now consistently the "workspace directory" — env var `PRISMALENS_USER_FOLDER` → `PRISMALENS_WORKSPACE_DIR`, config key `workspace.base_dir` → `workspace.dir`, flag `--base-dir` → `--workspace-dir` (renames, no aliases); explicit env-var paths are used verbatim (no `.prismalens` suffix appended); invalid flags print the error + a one-line help hint instead of the full help dump; registry default models refreshed (incl. replacing Groq's `llama-3.3-70b-versatile`, EOL 2026-08-16, with `openai/gpt-oss-120b`).
