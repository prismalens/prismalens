// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, test } from "@playwright/test";
import { measurePage } from "./page-measure";

// The matrix's tap-overlap count followed wherever the shot left the scroll: turn rows under the
// sticky header or the composer counted against their controls (#1238). This page holds that
// scroll still: one row fully under a sticky header, one 8 px under a fixed composer, and one
// hanging 14 px past its scroll pane's edge over the control below it.
const PAGE = `<!doctype html><style>
	body { margin: 0; font: 14px sans-serif; }
	button { border: 0; padding: 0; }
	header { position: sticky; top: 0; height: 34px; background: #222; z-index: 2; }
	header button { width: 40px; height: 34px; }
	.row { position: absolute; left: 0; width: 300px; height: 34px; }
	footer { position: fixed; bottom: 0; left: 0; right: 0; height: 48px; background: #222; z-index: 2; }
	footer button { width: 80px; height: 38px; }
	.pair { position: absolute; top: 300px; left: 20px; display: flex; gap: 2px; }
	.pair button { position: relative; width: 36px; height: 36px; }
	.pair button::after { content: ""; position: absolute; width: 48px; height: 48px; left: -6px; top: -6px; }
	.pane { position: absolute; top: 360px; left: 0; width: 390px; height: 100px; overflow: auto; }
	.pane > div { position: relative; height: 300px; }
	.send { position: absolute; top: 460px; left: 0; width: 80px; height: 38px; }
</style>
<header><button>Menu</button></header>
<main>
	<button class="row" style="top: 0">Under the header</button>
	<button class="row" style="top: 526px">Under the composer</button>
	<div class="pair"><button>Copy</button><button>Fork</button></div>
	<div class="pane"><div><button class="row" style="top: 80px">Past the pane's edge</button></div></div>
	<button class="send">Send</button>
</main>
<footer><button>Reply</button></footer>`;

test.use({ viewport: { width: 390, height: 600 } });

test("a control under a sticky header or a fixed composer is no tap overlap, and a real one still counts (#1238)", async ({
	page,
}) => {
	await page.setContent(PAGE);
	const { tapOverlaps } = await page.evaluate(measurePage);
	expect(tapOverlaps).toEqual(["Copy / Fork 10x48"]);
});
