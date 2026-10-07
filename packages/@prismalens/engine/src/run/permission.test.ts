// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { allowAllPolicy } from "./permission.js";

describe("allowAllPolicy", () => {
      it("prefers allow_once", () => {
              const d = allowAllPolicy({ options: [{ optionId: "always", kind: "allow_always" }, { optionId: "once", kind: "allow_once" }] });
              expect(d).toEqual({ allow: true, optionId: "once" });
      });
      it("falls back to any allow option", () => {
              const d = allowAllPolicy({ options: [{ optionId: "no", kind: "reject_once" }, { optionId: "always", kind: "allow_always" }] });
              expect(d).toEqual({ allow: true, optionId: "always" });
      });
      it("cancels when the harness offers no allow option", () => {
              const d = allowAllPolicy({ options: [{ optionId: "no", kind: "reject_once" }] });
              expect(d.allow).toBe(false);
      });
});
