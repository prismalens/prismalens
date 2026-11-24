// Each line below must be flagged by no-direct-clock.grit; lint-rules.int.spec.ts counts them.
export const a = Date.now();
export const b = new Date();
export const c = setTimeout(() => {}, 1);
export const d = setInterval(() => {}, 1);
export const e = globalThis.setTimeout(() => {}, 1);
export const f = globalThis.setInterval(() => {}, 1);
export const g = process.kill(1, 0);

// Allowed: parsing a value, and the clock's own door.
export const ok1 = new Date(0);
export const ok2 = new Date("2026-01-01");
export const ok3 = clock.now();
export const ok4 = clock.setTimeout(() => {}, 1);
