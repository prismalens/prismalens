// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The interface font for the first paint (#1101 category 12): IBM Plex Sans cut to the glyphs
// the UI draws, the rest of its Latin file behind the remaining code points, and a fallback
// sized to Plex's metrics so the swap moves nothing. Run after a Plex upgrade:
//   node scripts/fonts.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createFontStack } from "@capsizecss/core";
import arial from "@capsizecss/metrics/arial";
import ibmPlexSans from "@capsizecss/metrics/ibmPlexSans";
import subsetFont from "subset-font";

const require = createRequire(import.meta.url);
const pkg = "@fontsource-variable/ibm-plex-sans";
const files = `../../node_modules/${pkg}/files`;
const latin = require.resolve(
	`${pkg}/files/ibm-plex-sans-latin-wght-normal.woff2`,
);

/** What the UI's own words use: ASCII, Latin-1's symbols, and its dashes, quotes, dots, arrows and minus. */
const UI = [
	[0x20, 0x7e],
	[0xa0, 0xbf],
	[0xd7, 0xd7],
	[0xf7, 0xf7],
	[0x2013, 0x2014],
	[0x2018, 0x2019],
	[0x201c, 0x201d],
	[0x2022, 0x2022],
	[0x2026, 0x2026],
	[0x2191, 0x2191],
	[0x2193, 0x2193],
	[0x2212, 0x2212],
];
/** The UI's weights: normal, medium and semibold. */
const WEIGHTS = { min: 400, max: 600 };
/** Fontsource's Latin range less UI: the full Latin file loads only for these, accented letters among them. */
const REST =
	"U+0000-001F,U+007F-009F,U+00C0-00D6,U+00D8-00F6,U+00F8-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-2012,U+2015-2017,U+201A-201B,U+201E-2021,U+2023-2025,U+2027-206F,U+20AC,U+2122,U+2215,U+FEFF,U+FFFD";
/** Fontsource's other scripts, unchanged: each loads only when the page has its text. */
const SCRIPTS = {
	"cyrillic-ext":
		"U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F",
	cyrillic: "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116",
	greek: "U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF",
	vietnamese:
		"U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB",
	"latin-ext":
		"U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
};

const hex = (n) => n.toString(16).toUpperCase().padStart(4, "0");
const text = UI.flatMap(([a, b]) =>
	Array.from({ length: b - a + 1 }, (_, i) => String.fromCodePoint(a + i)),
).join("");
const range = UI.map(([a, b]) =>
	a === b ? `U+${hex(a)}` : `U+${hex(a)}-${hex(b)}`,
).join(",");

const cut = await subsetFont(readFileSync(latin), text, {
	targetFormat: "woff2",
	variationAxes: { wght: WEIGHTS },
});
writeFileSync(
	new URL("../src/assets/fonts/ibm-plex-sans-ui.woff2", import.meta.url),
	cut,
);

const face = (src, unicodeRange, weight = "100 700") => `@font-face {
  font-family: 'IBM Plex Sans Variable';
  font-style: normal;
  font-display: swap;
  font-weight: ${weight};
  src: url(${src}) format('woff2-variations');
  unicode-range: ${unicodeRange};
}`;
const { fontFaces } = createFontStack([ibmPlexSans, arial], {
	fontFaceFormat: "styleString",
});

writeFileSync(
	new URL("../src/styles/fonts.css", import.meta.url),
	`/* Written by scripts/fonts.mjs; edit that, not this. The UI's glyphs come from a ${cut.length}-byte
   cut of IBM Plex Sans, and the fallback is sized to its metrics so the swap moves nothing. */
${face("../assets/fonts/ibm-plex-sans-ui.woff2", range, `${WEIGHTS.min} ${WEIGHTS.max}`)}

${face(`${files}/ibm-plex-sans-latin-wght-normal.woff2`, REST)}

${Object.entries(SCRIPTS)
	.map(([s, r]) => face(`${files}/ibm-plex-sans-${s}-wght-normal.woff2`, r))
	.join("\n\n")}
`,
);
// The fallback is local, so the first paint has it; the faces above load after (lib/late-fonts.ts).
writeFileSync(
	new URL("../src/styles/font-fallback.css", import.meta.url),
	`/* Written by scripts/fonts.mjs: Arial sized to IBM Plex Sans, drawn until Plex loads. */
${fontFaces}
`,
);
console.log(
	`ibm-plex-sans-ui.woff2: ${cut.length} B (Latin file ${readFileSync(latin).length} B)`,
);
