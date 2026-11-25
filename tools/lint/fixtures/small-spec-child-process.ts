// Flagged: a small spec importing child_process. Allowed: a type-only import.
import { execFileSync } from "node:child_process";
import cp from "child_process";
import type { ChildProcess } from "node:child_process";

export { execFileSync, cp };
export type { ChildProcess };
