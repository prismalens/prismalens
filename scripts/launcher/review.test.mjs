// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The launcher against the failures adversary round 2 reproduced on #1165 (#717): a runtime
// pruned before its pointer moved, a crashed install's staging dir run as a runtime, a warm
// cache bypassing the manifest pin, a damaged entry point run as if whole, and npm's proxy
// and CA settings lost to `npm config get` refusing protected keys.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	truncateSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import {
	HOST,
	httpsServer,
	installLauncher,
	lastJson,
	launch,
	release,
	serveDir,
	tlsCert,
	workdir,
} from "./fixtures.mjs";
import {
	parseNpmrc,
	readNpmConfig,
	readPointer,
	writePointer,
} from "./launcher.mjs";

const servers = [];
after(() => {
	for (const s of servers) s.close();
});

function setup(version = "0.5.6") {
	const dir = workdir();
	return {
		dir,
		bin: installLauncher(join(dir, "pkg"), version),
		mirror: join(dir, "mirror"),
		cache: join(dir, "cache"),
	};
}

test("1: a runtime installed for a switch survives a concurrent switch's prune", async () => {
	const { bin, mirror, cache } = setup();
	release(mirror, "0.5.6");
	release(mirror, "0.5.7-nightly.20261117.3");
	const { url } = release(mirror, "0.5.7-nightly.20261117.4");
	const env = {
		PRISMALENS_LAUNCHER_DIR: cache,
		PRISMALENS_RELEASE_BASE_URL: url,
	};
	assert.equal((await launch(bin, ["--exit", "0"], env)).status, 0);
	for (let round = 0; round < 4; round++) {
		const [a, b] = await Promise.all([
			launch(
				bin,
				[
					"--launcher-switch",
					"nightly",
					"--version",
					"0.5.7-nightly.20261117.3",
				],
				env,
			),
			launch(
				bin,
				[
					"--launcher-switch",
					"nightly",
					"--version",
					"0.5.7-nightly.20261117.4",
				],
				env,
			),
		]);
		assert.equal(a.status, 0, a.stderr);
		assert.equal(b.status, 0, b.stderr);
		const p = readPointer(cache, HOST);
		for (const which of ["current", "previous"])
			assert.ok(
				existsSync(join(cache, p[which].dir)),
				`round ${round}: ${which} ${p[which].dir} is gone`,
			);
		const offline = await launch(bin, [], {
			...env,
			PRISMALENS_RELEASE_BASE_URL: "https://127.0.0.1:9/gone",
		});
		assert.equal(offline.status, 0, offline.stderr);
		assert.equal(
			lastJson(offline.stdout).version,
			p.current.version,
			`round ${round} ran ${offline.stdout}`,
		);
		assert.doesNotMatch(offline.stderr, /no longer on the release server/);
	}
});

test("2: a crashed install's staging dir is never run, and a pointer never names it", async () => {
	const { bin, mirror, cache } = setup();
	const { url } = release(mirror, "0.5.6");
	const env = {
		PRISMALENS_LAUNCHER_DIR: cache,
		PRISMALENS_RELEASE_BASE_URL: url,
	};
	assert.equal((await launch(bin, ["--exit", "0"], env)).status, 0);
	const { dir } = readPointer(cache, HOST).current;
	renameSync(join(cache, dir), join(cache, ".staging-crash"));
	writeFileSync(join(cache, `active-${HOST}.json`), "{}");
	const r = await launch(bin, ["--exit", "0"], env);
	assert.equal(r.status, 0, r.stderr);
	const p = readPointer(cache, HOST);
	assert.doesNotMatch(
		p.current.dir,
		/^\./,
		`the pointer names ${p.current.dir}`,
	);
	assert.ok(existsSync(join(cache, p.current.dir)));
});

test("3: a warm cache never runs an archive the manifest does not pin", async () => {
	const dir = workdir();
	const mirror = join(dir, "mirror");
	const cache = join(dir, "cache");
	const { url } = release(mirror, "0.5.6");
	const unpinned = installLauncher(join(dir, "unpinned"), "0.5.6");
	assert.equal(
		(
			await launch(unpinned, ["--exit", "0"], {
				PRISMALENS_LAUNCHER_DIR: cache,
				PRISMALENS_RELEASE_BASE_URL: url,
			})
		).status,
		0,
	);
	const pinned = installLauncher(join(dir, "pinned"), "0.5.6", {
		[HOST]: "a".repeat(64),
	});
	const warm = await launch(pinned, ["--exit", "0"], {
		PRISMALENS_LAUNCHER_DIR: cache,
		PRISMALENS_RELEASE_BASE_URL: url,
	});
	assert.equal(warm.status, 1, `the warm cache ran: ${warm.stdout}`);
	assert.match(
		warm.stderr,
		/checksum mismatch .*the digest npm's launcher pins says a{64}/,
	);
});

test("4: a truncated or altered entry point is quarantined and fetched once more; repair does it on demand", async () => {
	const { bin, mirror, cache } = setup();
	const { url } = release(mirror, "0.5.6");
	const env = {
		PRISMALENS_LAUNCHER_DIR: cache,
		PRISMALENS_RELEASE_BASE_URL: url,
	};
	assert.equal((await launch(bin, ["--exit", "0"], env)).status, 0);
	const entry = () =>
		join(
			cache,
			readPointer(cache, HOST).current.dir,
			"app",
			"dist",
			"bin",
			"prismalens.js",
		);

	truncateSync(entry(), 10);
	const truncated = await launch(bin, ["--exit", "0"], env);
	assert.equal(truncated.status, 0, truncated.stderr);
	assert.match(
		truncated.stderr,
		/the cached 0\.5\.6 runtime is damaged \(app[/\\]dist[/\\]bin[/\\]prismalens\.js changed size\); moved it to .*\.damaged-\d+ and downloading it again/,
	);
	assert.equal(lastJson(truncated.stdout).version, "0.5.6");

	const bytes = readFileSync(entry());
	bytes[0] ^= 0xff;
	writeFileSync(entry(), bytes);
	const flipped = await launch(bin, ["--exit", "0"], env);
	assert.equal(flipped.status, 0, flipped.stderr);
	assert.match(
		flipped.stderr,
		/damaged \(app[/\\]dist[/\\]bin[/\\]prismalens\.js changed\); moved it to/,
	);

	const repaired = await launch(bin, ["--launcher-repair"], env);
	assert.equal(repaired.status, 0, repaired.stderr);
	assert.match(repaired.stderr, /: whole\n/);
	assert.match(repaired.stderr, /prismalens: repaired stable 0\.5\.6 in /);
});

test("5: npm's cafile is read from its npmrc even when npm refuses to print its proxy keys", async () => {
	assert.deepEqual(
		parseNpmrc(
			'; comment\nhttps-proxy = "http://u:p@proxy.corp:3128"\nnoproxy=.corp\ncafile=${CA_DIR}/corp.pem\n[section]\nregistry=x\n',
			{ CA_DIR: "/etc/ssl" },
		),
		{
			"https-proxy": "http://u:p@proxy.corp:3128",
			noproxy: ".corp",
			cafile: resolve("/etc/ssl/corp.pem"),
		},
	);
	const { dir, bin, mirror, cache } = setup();
	release(mirror, "0.5.6");
	const srv = await httpsServer(serveDir(mirror));
	servers.push(srv);
	const npmrc = join(dir, "npmrc");
	writeFileSync(
		npmrc,
		`https-proxy=http://user:pw@127.0.0.1:9\nnoproxy=127.0.0.1,localhost\ncafile=${tlsCert().file}\n`,
	);
	const r = await launch(bin, ["--exit", "0"], {
		PRISMALENS_LAUNCHER_DIR: cache,
		PRISMALENS_RELEASE_BASE_URL: srv.url,
		npm_config_userconfig: npmrc,
		NODE_EXTRA_CA_CERTS: "",
		HTTPS_PROXY: "",
		https_proxy: "",
		HTTP_PROXY: "",
		http_proxy: "",
	});
	assert.equal(r.status, 0, r.stderr);
	assert.doesNotMatch(r.stderr, /pw@/);

	const untrusted = await launch(bin, ["--exit", "0"], {
		PRISMALENS_LAUNCHER_DIR: join(dir, "cache-2"),
		PRISMALENS_RELEASE_BASE_URL: srv.url,
		npm_config_userconfig: join(dir, "none"),
		NODE_EXTRA_CA_CERTS: "",
		PRISMALENS_LAUNCHER_TIMEOUT_SECONDS: "5",
	});
	assert.equal(untrusted.status, 1);
	assert.match(
		untrusted.stderr,
		/DEPTH_ZERO_SELF_SIGNED_CERT\) .* Its certificate is not trusted here: behind a TLS-inspecting proxy, set NODE_EXTRA_CA_CERTS/,
	);
});

// --- adversary round 3 --------------------------------------------------------------------

async function waitFor(file, text) {
	for (let i = 0; i < 200; i++) {
		if (existsSync(file) && readFileSync(file, "utf8").includes(text)) return;
		await new Promise((r) => setTimeout(r, 50));
	}
	throw new Error(`${file} never said ${text}`);
}

test("r3-1: repair and quarantine never move a runtime a running PrismaLens uses", async () => {
	const { dir, bin, mirror, cache } = setup();
	const { url } = release(mirror, "0.5.6");
	const env = {
		PRISMALENS_LAUNCHER_DIR: cache,
		PRISMALENS_RELEASE_BASE_URL: url,
	};
	assert.equal((await launch(bin, ["--exit", "0"], env)).status, 0);
	const log = join(dir, "app.log");
	let app;
	const running = launch(bin, ["--signals", log], env, {
		onSpawn: (c) => {
			app = c;
		},
	});
	await waitFor(log, "ready");
	const used = readPointer(cache, HOST).current.dir;
	const entry = join(cache, used, "app", "dist", "bin", "prismalens.js");
	try {
		truncateSync(entry, 10);
		const second = await launch(bin, ["--exit", "0"], env);
		assert.equal(second.status, 0, second.stderr);
		assert.match(
			second.stderr,
			/damaged \(.*changed size\), and a running PrismaLens still uses it; downloading a fresh copy beside it/,
		);
		assert.ok(
			existsSync(join(cache, used)),
			"a damaged runtime in use was moved",
		);

		const before = readPointer(cache, HOST).current.dir;
		const offline = await launch(bin, ["--launcher-repair"], {
			...env,
			PRISMALENS_RELEASE_BASE_URL: "https://127.0.0.1:9/gone",
			PRISMALENS_LAUNCHER_TIMEOUT_SECONDS: "3",
		});
		assert.equal(offline.status, 1);
		assert.equal(
			readPointer(cache, HOST).current.dir,
			before,
			"an offline repair moved the pointer",
		);
		assert.ok(
			existsSync(join(cache, before, "app", "dist", "bin", "prismalens.js")),
			"an offline repair removed the runtime",
		);

		const online = await launch(bin, ["--launcher-repair"], env);
		assert.equal(online.status, 0, online.stderr);
		assert.match(online.stderr, /prismalens: repaired stable 0\.5\.6 in /);
		assert.ok(
			existsSync(join(cache, used)),
			"repair moved a runtime a running PrismaLens uses",
		);
	} finally {
		app.kill();
		await running;
	}
});

test("r3-3: a missing, legacy or malformed install record is unverified: fetched again, never trusted, never a crash", async () => {
	const { bin, mirror, cache } = setup();
	const { url } = release(mirror, "0.5.6");
	const env = {
		PRISMALENS_LAUNCHER_DIR: cache,
		PRISMALENS_RELEASE_BASE_URL: url,
	};
	const records = {
		legacy: (m) => ({
			version: m.version,
			target: m.target,
			tag: m.tag,
			sha256: m.sha256,
			files: {
				[join("app", "dist", "bin", "prismalens.js")]: {
					size: 1,
					sha256: "a".repeat(64),
				},
			},
		}),
		empty: (m) => ({
			version: m.version,
			target: m.target,
			tag: m.tag,
			sha256: m.sha256,
			files: {},
		}),
		nullFile: (m) => ({
			version: m.version,
			target: m.target,
			tag: m.tag,
			sha256: m.sha256,
			files: { x: null },
		}),
	};
	for (const [label, make] of Object.entries(records)) {
		assert.equal((await launch(bin, ["--exit", "0"], env)).status, 0);
		const { dir } = readPointer(cache, HOST).current;
		const meta = JSON.parse(
			readFileSync(join(cache, dir, ".complete"), "utf8"),
		);
		writeFileSync(join(cache, dir, ".complete"), JSON.stringify(make(meta)));
		truncateSync(join(cache, dir, "app", "dist", "bin", "prismalens.js"), 10);
		const r = await launch(bin, ["--exit", "0"], env);
		assert.equal(r.status, 0, `${label}: ${r.stderr}`);
		assert.match(
			r.stderr,
			/its install record is missing or incomplete, so it is unverified\); moved it to/,
			label,
		);
		assert.equal(lastJson(r.stdout).version, "0.5.6", label);
	}
	const { dir } = readPointer(cache, HOST).current;
	writeFileSync(join(cache, dir, ".complete"), "null");
	const r = await launch(bin, ["--exit", "0"], env);
	assert.equal(r.status, 0, r.stderr);
	assert.doesNotMatch(r.stderr, /TypeError/);
});

test("r3-4: a node binary damaged at the same size is found and fetched again", async () => {
	const { bin, mirror, cache } = setup();
	const { url } = release(mirror, "0.5.6");
	const env = {
		PRISMALENS_LAUNCHER_DIR: cache,
		PRISMALENS_RELEASE_BASE_URL: url,
	};
	assert.equal((await launch(bin, ["--exit", "0"], env)).status, 0);
	const { dir } = readPointer(cache, HOST).current;
	const node = join(
		cache,
		dir,
		"node",
		...(HOST.startsWith("win32") ? ["node.exe"] : ["bin", "node"]),
	);
	const bytes = readFileSync(node);
	bytes[2] ^= 0xff;
	bytes[3] ^= 0xff;
	writeFileSync(node, bytes);
	const r = await launch(bin, ["--exit", "0"], env);
	assert.equal(r.status, 0, r.stderr);
	assert.match(
		r.stderr,
		/damaged \(node[/\\](bin[/\\]node|node\.exe) changed\); moved it to/,
	);
	assert.equal(lastJson(r.stdout).version, "0.5.6");
});

test("r3-5: npmrc values follow npm: inline comments, arrays, ${VAR}, and the project's .npmrc", async () => {
	const ca = process.platform === "win32" ? "C:/corp.pem" : "/etc/corp.pem";
	const text = `cafile=${ca} # certificate\nnoproxy[]=localhost\nnoproxy[]=127.0.0.1\nproxy=\${PROXY_HOST}\nhttps-proxy=\${UNSET_VAR?}\n`;
	assert.deepEqual(parseNpmrc(text, { PROXY_HOST: "http://proxy.corp:3128" }), {
		cafile: resolve(ca),
		noproxy: "localhost,127.0.0.1",
		proxy: "http://proxy.corp:3128",
	});
	const dir = workdir();
	writeFileSync(join(dir, "npmrc"), text);
	const npm = (key) => {
		const r = spawnSync(
			process.platform === "win32" ? "cmd.exe" : "npm",
			[
				...(process.platform === "win32" ? ["/d", "/c", "npm"] : []),
				"config",
				"get",
				key,
			],
			{
				encoding: "utf8",
				windowsHide: true,
				env: {
					...process.env,
					npm_config_userconfig: join(dir, "npmrc"),
					PROXY_HOST: "http://proxy.corp:3128",
				},
			},
		);
		return r.stdout.trim();
	};
	assert.equal(npm("cafile"), resolve(ca));
	assert.equal(npm("noproxy"), "localhost,127.0.0.1");
	const project = join(dir, "project");
	mkdirSync(join(project, "sub"), { recursive: true });
	writeFileSync(join(project, "package.json"), "{}");
	writeFileSync(join(project, ".npmrc"), "cafile=/project/ca.pem\n");
	assert.equal(
		readNpmConfig(
			{ npm_config_userconfig: join(dir, "none") },
			process.execPath,
			join(project, "sub"),
		).cafile,
		resolve("/project/ca.pem"),
	);
});

// One racer: takes the lock until it has held it `holds` times, leaving it as a crashed holder
// would a third of the time; otherwise breaks a stale lock it sees. `inside` is created
// exclusively while holding, so a second holder at the same moment is counted, as is a holder
// whose lock was moved away under it; a lock left stuck stops the racers short of their holds.
const RACER = `
import * as fs from "node:fs";
import { join } from "node:path";
const [src, file, inside, holds] = process.argv.slice(1);
const m = await import(src);
const tryLock = m.tryLock ?? ((f) => {
	const owner = m.ownerRecord();
	const tmp = f + ".tmp-" + owner.token;
	fs.mkdirSync(tmp);
	fs.writeFileSync(join(tmp, "owner"), JSON.stringify(owner));
	try { fs.renameSync(tmp, f); return owner.token; }
	catch { fs.rmSync(tmp, { recursive: true, force: true }); return null; }
});
const n = { held: 0, both: 0, lost: 0, crashed: 0, broken: 0 };
const until = Date.now() + 30_000;
for (let i = 0; n.held < Number(holds) && Date.now() < until; i++) {
	const token = tryLock(file);
	if (!token) {
		const seen = m.lockHolder(file);
		if (seen.stale && m.breakLock(file, seen.token)) n.broken++;
		continue;
	}
	n.held++;
	let fd;
	try { fd = fs.openSync(inside, "wx"); } catch { n.both++; m.releaseLock(file, token); continue; }
	fs.closeSync(fd);
	const owner = join(file, "owner");
	let mine = null;
	try { mine = JSON.parse(fs.readFileSync(owner, "utf8")); } catch {}
	fs.unlinkSync(inside);
	if (mine?.token !== token) { n.lost++; continue; }
	if (n.held % 3 === 0) {
		try { fs.writeFileSync(owner, JSON.stringify({ ...mine, pid: 999999 })); n.crashed++; } catch { n.lost++; }
	} else m.releaseLock(file, token);
}
console.log(JSON.stringify(n));
`;

test("cr-568b: reclaimers racing new holders never leave two holders of one lock", async () => {
	const dir = workdir();
	const file = join(dir, ".lock-x");
	const src = process.env.PL_LAUNCHER_SOURCE
		? pathToFileURL(resolve(process.env.PL_LAUNCHER_SOURCE)).href
		: new URL("./launcher.mjs", import.meta.url).href;
	const racers = Array.from({ length: 8 }, () => {
		const child = spawn(
			process.execPath,
			[
				"--input-type=module",
				"-e",
				RACER,
				src,
				file,
				join(dir, "inside"),
				"40",
			],
			{ stdio: ["ignore", "pipe", "inherit"] },
		);
		let out = "";
		child.stdout.on("data", (d) => {
			out += d;
		});
		return once(child, "exit").then(([code]) => {
			assert.equal(code, 0);
			return JSON.parse(out);
		});
	});
	const total = (await Promise.all(racers)).reduce((a, n) => {
		for (const k of Object.keys(n)) a[k] = (a[k] ?? 0) + n[k];
		return a;
	});
	assert.equal(total.both, 0, `two holders at once: ${JSON.stringify(total)}`);
	assert.equal(
		total.lost,
		0,
		`a held lock was moved away: ${JSON.stringify(total)}`,
	);
	assert.equal(
		total.held,
		8 * 40,
		`a displaced lock stayed stuck: ${JSON.stringify(total)}`,
	);
	assert.ok(total.broken > 50, JSON.stringify(total));
});

test("cr-568c: a holder whose lock was broken knows it, and its unlock leaves the next holder's lock", async () => {
	const { breakLock, lock, lockHolder, tryLock } = await import(
		"./launcher.mjs"
	);
	const file = join(workdir(), ".lock-x");
	const unlock = await lock(file, { deadline: Date.now() + 5000 });
	assert.equal(unlock.owns(), true);
	// It stalls past its heartbeat; another launcher breaks the lock and takes it.
	const owner = join(file, "owner");
	writeFileSync(
		owner,
		JSON.stringify({ ...JSON.parse(readFileSync(owner, "utf8")), pid: 999999 }),
	);
	assert.equal(breakLock(file, lockHolder(file).token), true);
	const next = tryLock(file);
	assert.ok(next);
	assert.equal(unlock.owns(), false);
	unlock();
	assert.equal(lockHolder(file).token, next);
});

// --- CodeRabbit review on b72fc2e5 ---------------------------------------------------------

test("cr-568: a lock is only released or broken by the acquisition that saw it", async () => {
	const { breakLock, releaseLock } = await import("./launcher.mjs");
	const dir = workdir();
	const file = join(dir, ".lock-x");
	mkdirSync(file);
	writeFileSync(
		join(file, "owner"),
		JSON.stringify({ pid: process.pid, token: "live" }),
	);
	assert.equal(breakLock(file, "old"), false);
	assert.equal(
		JSON.parse(readFileSync(join(file, "owner"), "utf8")).token,
		"live",
	);
	assert.equal(releaseLock(file, "someone-else"), false);
	assert.ok(existsSync(file));
	assert.equal(releaseLock(file, "live"), true);
	assert.ok(!existsSync(file));
});

test("cr-971: switching to a nightly this copy verified keeps the digest it was verified with", async () => {
	const { bin, mirror, cache } = setup();
	release(mirror, "0.5.6");
	const { url } = release(mirror, "0.5.7-nightly.20261117.3");
	const env = {
		PRISMALENS_LAUNCHER_DIR: cache,
		PRISMALENS_RELEASE_BASE_URL: url,
	};
	const sw = [
		"--launcher-switch",
		"nightly",
		"--version",
		"0.5.7-nightly.20261117.3",
	];
	assert.equal((await launch(bin, sw, env)).status, 0);
	const verified = readPointer(cache, HOST).current;
	rmSync(join(cache, verified.dir), { recursive: true });
	rmSync(join(mirror, "v0.5.7-nightly.20261117.3"), { recursive: true });
	release(mirror, "0.5.7-nightly.20261117.3", { migrations: ["other"] });
	const again = await launch(bin, sw, env);
	assert.equal(
		again.status,
		1,
		`a swapped nightly was accepted: ${again.stderr}`,
	);
	assert.match(
		again.stderr,
		/SHA256SUMS now lists .* but this copy verified 0\.5\.7-nightly\.20261117\.3/,
	);
});

test("cr-1011: going back to a previous stable needs that stable's launcher, so nothing silently overrides it", async () => {
	const dir = workdir();
	const mirror = join(dir, "mirror");
	const cache = join(dir, "cache");
	release(mirror, "0.5.5");
	const { url } = release(mirror, "0.5.6");
	const env = {
		PRISMALENS_LAUNCHER_DIR: cache,
		PRISMALENS_RELEASE_BASE_URL: url,
	};
	assert.equal(
		(
			await launch(
				installLauncher(join(dir, "old"), "0.5.5"),
				["--exit", "0"],
				env,
			)
		).status,
		0,
	);
	const bin = installLauncher(join(dir, "new"), "0.5.6");
	assert.equal((await launch(bin, ["--exit", "0"], env)).status, 0);
	const back = await launch(bin, ["--launcher-switch", "previous"], env);
	assert.equal(back.status, 1, back.stderr);
	assert.match(
		back.stderr,
		/the previous runtime is stable 0\.5\.5, but this launcher runs stable 0\.5\.6; install that launcher with npm install -g prismalens@0\.5\.5/,
	);
	assert.equal(readPointer(cache, HOST).current.version, "0.5.6");
});

test("cr-1015: a launch that waited never overwrites a channel switch made meanwhile", async () => {
	const { bin, mirror, cache } = setup();
	release(mirror, "0.5.6");
	release(mirror, "0.5.7-nightly.20261117.3");
	const srv = await httpsServer((req, res) => {
		const send = () => serveDir(mirror)(req, res);
		if (req.url.includes("/v0.5.6/prismalens-")) setTimeout(send, 4000);
		else send();
	});
	servers.push(srv);
	const env = {
		PRISMALENS_LAUNCHER_DIR: cache,
		PRISMALENS_RELEASE_BASE_URL: srv.url,
		NODE_EXTRA_CA_CERTS: tlsCert().file,
	};
	const slow = launch(bin, ["--exit", "0"], env);
	await new Promise((r) => setTimeout(r, 1500));
	const sw = await launch(
		bin,
		["--launcher-switch", "nightly", "--version", "0.5.7-nightly.20261117.3"],
		env,
	);
	assert.equal(sw.status, 0, sw.stderr);
	const first = await slow;
	assert.equal(first.status, 0, first.stderr);
	assert.equal(
		readPointer(cache, HOST).current.channel,
		"nightly",
		"the slow launch overwrote the switch",
	);
	assert.equal(lastJson(first.stdout).version, "0.5.7-nightly.20261117.3");
});

test("cr-1015b: a launch whose pointer changes on every try stops with an error and runs nothing", async () => {
	const { bin, mirror, cache } = setup();
	release(mirror, "0.5.6");
	// Every try downloads the nightly it read, slowly, and finds the pointer moved on to another.
	const nightlies = Array.from(
		{ length: 30 },
		(_, i) => `0.5.7-nightly.20261117.${i + 1}`,
	);
	for (const v of nightlies) release(mirror, v);
	const srv = await httpsServer((req, res) => {
		const send = () => serveDir(mirror)(req, res);
		if (/-nightly\.[\d.]+\/prismalens-/.test(req.url)) setTimeout(send, 800);
		else send();
	});
	servers.push(srv);
	const point = (i) =>
		writePointer(cache, HOST, {
			current: {
				channel: "nightly",
				version: nightlies[i],
				tag: `v${nightlies[i]}`,
				target: HOST,
			},
			previous: null,
		});
	let i = 0;
	point(i);
	const flip = setInterval(() => {
		if (i + 1 < nightlies.length) point(++i);
	}, 500);
	try {
		const r = await launch(bin, ["--exit", "0"], {
			PRISMALENS_LAUNCHER_DIR: cache,
			PRISMALENS_RELEASE_BASE_URL: srv.url,
			NODE_EXTRA_CA_CERTS: tlsCert().file,
		});
		assert.equal(r.status, 1, `a stale selection ran: ${r.stdout}`);
		assert.ok(
			i + 1 < nightlies.length,
			"the pointer stopped moving before the launch ended",
		);
		assert.match(
			r.stderr,
			/changed on each of 4 tries while this launch waited; nothing was started/,
		);
		assert.equal(r.stdout, "");
	} finally {
		clearInterval(flip);
	}
});

test("cr-1051: repair works when the cache folder is gone", async () => {
	const { bin, mirror, cache } = setup();
	const { url } = release(mirror, "0.5.6");
	const r = await launch(bin, ["--launcher-repair"], {
		PRISMALENS_LAUNCHER_DIR: join(cache, "never-made"),
		PRISMALENS_RELEASE_BASE_URL: url,
	});
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stderr, /repaired stable 0\.5\.6/);
});
