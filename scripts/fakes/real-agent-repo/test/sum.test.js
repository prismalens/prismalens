import assert from "node:assert/strict";
import { test } from "node:test";
import { sum } from "../src/sum.js";

test("sums every item in the cart", () => {
	assert.equal(sum([{ cents: 250 }, { cents: 100 }, { cents: 5 }]), 355);
});
