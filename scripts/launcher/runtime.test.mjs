// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The launcher's runtime cache, pointer, network and signal handling, run as a real child
// process against real archives in local mirrors (#717).
import assert from "node:assert/strict";
import fsModule, {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import net from "node:net";
import { join, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import {
	HOST,
	httpsServer,
	installLauncher,
	lastJson,
	launch,
	release,
	serveDir,
	sha256,
	tlsCert,
	WIN,
	workdir,
} from "./fixtures.mjs";
import {
	breakLock,
	detectTarget,
	holds,
	lockHolder,
	ownerRecord,
	parseBase,
	prune,
	readPointer,
	retryAfterMs,
	TARGETS,
	tryLock,
} from "./launcher.mjs";

const servers = [];
after(() => {
	for (const s of servers) s.close();
});

function setup(version = "0.5.6") {
	const dir = workdir();
	const bin = installLauncher(join(dir, "pkg"), version);
	const mirror = join(dir, "mirror");
	const cache = join(dir, "cache");
	return { dir, bin, mirror, cache };
}

test("first run downloads, verifies and runs; the next run needs no network", async () => {
	const { bin, mirror, cache } = setup();
	const { url } = release(mirror, "0.5.6");
	const env = {
		PRISMALENS_LAUNCHER_DIR: cache,
		PRISMALENS_INSTALL: "standalone",
	};
	const first = await launch(bin, ["hello", "--exit", "7"], {
		...env,
		PRISMALENS_RELEASE_BASE_URL: url,
	});
	assert.equal(first.status, 7, first.stderr);
	const seen = lastJson(first.stdout);
	assert.deepEqual(seen.argv, ["hello", "--exit", "7"]);
	assert.equal(seen.version, "0.5.6");
	assert.equal(seen.install, null);
	assert.equal(seen.channel, "stable");
	const offline = await launch(bin, ["--exit", "0"], {
		...env,
		PRISMALENS_RELEASE_BASE_URL: "https://127.0.0.1:9/gone",
	});
	assert.equal(offline.status, 0, offline.stderr);
	assert.equal(readPointer(cache, HOST).current.version, "0.5.6");
});

test("a tampered archive is refused and nothing is cached or pointed at", async () => {
	const { bin, mirror, cache } = setup();
	const { url } = release(mirror, "0.5.6", { tamper: true });
	const r = await launch(bin, [], {
		PRISMALENS_LAUNCHER_DIR: cache,
		PRISMALENS_RELEASE_BASE_URL: url,
	});
	assert.equal(r.status, 1);
	assert.match(r.stderr, /checksum mismatch .* nothing was installed/);
	assert.equal(readPointer(cache, HOST), null);
	assert.deepEqual(
		readdirSync(cache).filter((n) => !n.startsWith(".")),
		[],
	);
});

test("stable -> nightly -> stable switches only after verifying, and runs what the pointer names", async () => {
	const { bin, mirror, cache } = setup();
	release(mirror, "0.5.6");
	const { url } = release(mirror, "0.5.7-nightly.20261117.3");
	const env = {
		PRISMALENS_LAUNCHER_DIR: cache,
		PRISMALENS_RELEASE_BASE_URL: url,
	};
	assert.equal(lastJson((await launch(bin, [], env)).stdout).version, "0.5.6");

	const toNightly = await launch(
		bin,
		["--launcher-switch", "nightly", "--version", "0.5.7-nightly.20261117.3"],
		env,
	);
	assert.equal(toNightly.status, 0, toNightly.stderr);
	assert.match(
		toNightly.stderr,
		/now running nightly 0\.5\.7-nightly\.20261117\.3/,
	);
	const onNightly = lastJson((await launch(bin, [], env)).stdout);
	assert.deepEqual(
		[onNightly.version, onNightly.channel],
		["0.5.7-nightly.20261117.3", "nightly"],
	);
	assert.equal(readPointer(cache, HOST).previous.version, "0.5.6");

	const missing = await launch(
		bin,
		["--launcher-switch", "nightly", "--version", "0.5.8-nightly.20261118.4"],
		env,
	);
	assert.equal(missing.status, 1);
	assert.equal(
		readPointer(cache, HOST).current.version,
		"0.5.7-nightly.20261117.3",
		"a failed switch moved the pointer",
	);

	const back = await launch(bin, ["--launcher-switch", "stable"], env);
	assert.equal(back.status, 0, back.stderr);
	assert.equal(lastJson((await launch(bin, [], env)).stdout).version, "0.5.6");
	assert.equal(readPointer(cache, HOST).previous.channel, "nightly");
});

function database(file, names) {
	const db = new DatabaseSync(file);
	db.exec(
		'CREATE TABLE "_prisma_migrations" ("id" TEXT PRIMARY KEY, "checksum" TEXT, "finished_at" DATETIME, "migration_name" TEXT, "logs" TEXT, "rolled_back_at" DATETIME, "started_at" DATETIME, "applied_steps_count" INTEGER)',
	);
	for (const [i, n] of names.entries())
		db.prepare(
			'INSERT INTO "_prisma_migrations" VALUES (?, ?, CURRENT_TIMESTAMP, ?, NULL, NULL, CURRENT_TIMESTAMP, 1)',
		).run(String(i), "x", n);
	db.close();
}

test("a switch to a runtime older than the workspace database is refused before the pointer moves", async () => {
	const { dir, bin, mirror, cache } = setup();
	release(mirror, "0.5.6", { migrations: ["20260901000000_init"] });
	const { url } = release(mirror, "0.5.7-nightly.20261117.3", {
		migrations: ["20260901000000_init", "20261117000000_threads"],
	});
	const env = {
		PRISMALENS_LAUNCHER_DIR: cache,
		PRISMALENS_RELEASE_BASE_URL: url,
	};
	const workspace = join(dir, "ws");
	mkdirSync(workspace);
	database(join(workspace, "prismalens.db"), [
		"20260901000000_init",
		"20261117000000_threads",
	]);
	const up = await launch(
		bin,
		[
			"--launcher-switch",
			"nightly",
			"--version",
			"0.5.7-nightly.20261117.3",
			"--workspace",
			workspace,
		],
		env,
	);
	assert.equal(up.status, 0, up.stderr);
	const down = await launch(
		bin,
		["--launcher-switch", "stable", "--workspace", workspace],
		env,
	);
	assert.equal(down.status, 1);
	assert.equal(
		down.stderr.trim(),
		`prismalens: ${join(workspace, "prismalens.db")} records a migration PrismaLens 0.5.6 does not ship (20261117000000_threads). Switching would leave pl up refusing to start ("migrations this build does not ship"). Nothing was changed: this copy stays on nightly 0.5.7-nightly.20261117.3. To go to 0.5.6 anyway, restore the prismalens.db.bak-* file made before those migrations, then switch again.`,
	);
	assert.equal(readPointer(cache, HOST).current.channel, "nightly");
});

test("a pointed-at nightly that was pruned from the server falls back to the recorded previous", async () => {
	const { bin, mirror, cache } = setup();
	release(mirror, "0.5.6");
	const { url } = release(mirror, "0.5.7-nightly.20261117.3");
	const env = {
		PRISMALENS_LAUNCHER_DIR: cache,
		PRISMALENS_RELEASE_BASE_URL: url,
	};
	assert.equal(
		(
			await launch(
				bin,
				[
					"--launcher-switch",
					"nightly",
					"--version",
					"0.5.7-nightly.20261117.3",
				],
				env,
			)
		).status,
		0,
	);
	const pointer = readPointer(cache, HOST);
	rmSync(join(cache, pointer.current.dir), { recursive: true });
	rmSync(join(mirror, "v0.5.7-nightly.20261117.3"), { recursive: true });
	const r = await launch(bin, ["--exit", "0"], env);
	assert.equal(r.status, 0, r.stderr);
	assert.match(
		r.stderr,
		/nightly 0\.5\.7-nightly\.20261117\.3 is no longer on the release server \(nightlies are pruned\) and is not cached here\. Running stable 0\.5\.6, recorded as previous/,
	);
	assert.doesNotMatch(r.stderr, /404|does not exist/);
	assert.equal(lastJson(r.stdout).version, "0.5.6");
	assert.equal(
		readPointer(cache, HOST).current.channel,
		"nightly",
		"the fallback moved the pointer",
	);
});

test("eight launchers starting on an empty cache download once and all run", async () => {
	const { bin, mirror, cache } = setup();
	release(mirror, "0.5.6");
	const srv = await httpsServer(serveDir(mirror));
	servers.push(srv);
	const env = {
		PRISMALENS_LAUNCHER_DIR: cache,
		PRISMALENS_RELEASE_BASE_URL: srv.url,
		NODE_EXTRA_CA_CERTS: tlsCert().file,
	};
	const runs = await Promise.all(
		Array.from({ length: 8 }, () => launch(bin, ["--exit", "0"], env)),
	);
	for (const r of runs) assert.equal(r.status, 0, r.stderr);
	const archive = [...srv.hits.keys()].find((k) =>
		k.endsWith(WIN ? ".zip" : ".tar.gz"),
	);
	assert.equal(srv.hits.get(archive), 1, JSON.stringify([...srv.hits]));
});

test("a damaged cached runtime is moved aside, downloaded again once, and runs", async () => {
	const { bin, mirror, cache } = setup();
	const { url } = release(mirror, "0.5.6");
	const env = {
		PRISMALENS_LAUNCHER_DIR: cache,
		PRISMALENS_RELEASE_BASE_URL: url,
	};
	assert.equal((await launch(bin, [], env)).status, 0);
	const { dir } = readPointer(cache, HOST).current;
	rmSync(join(cache, dir, "node", WIN ? "node.exe" : "bin"), {
		recursive: true,
	});
	const r = await launch(bin, ["--exit", "0"], env);
	assert.equal(r.status, 0, r.stderr);
	assert.match(
		r.stderr,
		new RegExp(
			`the cached 0\\.5\\.6 runtime is damaged \\(node[/\\\\]${WIN ? "node\\.exe" : "bin[/\\\\]node"} missing\\); moved it to .*\\.damaged-\\d+ and downloading it again`,
		),
	);
	assert.ok(
		existsSync(join(cache, readPointer(cache, HOST).current.dir, "node")),
	);
});

test("one cache directory serves two targets without either replacing the other", async () => {
	const { mirror, cache } = setup();
	const other = HOST === "linux-x64" ? "darwin-arm64" : "linux-x64";
	release(mirror, "0.5.6", { target: HOST });
	const { url } = release(mirror, "0.5.6", { target: other });
	const { ensureRuntime, makeNet } = await import("./launcher.mjs");
	const netw = makeNet({ env: { PRISMALENS_RELEASE_BASE_URL: url } });
	const a = await ensureRuntime(
		cache,
		{ version: "0.5.6", tag: "v0.5.6", target: HOST },
		netw,
	);
	const b = await ensureRuntime(
		cache,
		{ version: "0.5.6", tag: "v0.5.6", target: other },
		netw,
	);
	assert.notEqual(a.dir, b.dir);
	assert.notEqual(a.sha256, b.sha256);
	assert.match(
		a.dir,
		new RegExp(`0\\.5\\.6-${HOST}-${a.sha256.slice(0, 16)}-[0-9a-f]{6}$`),
	);
	assert.ok(
		existsSync(join(a.dir, ".complete")) &&
			existsSync(join(b.dir, ".complete")),
	);
});

test("prune keeps the active and previous runtimes and clears stale staging", () => {
	const cache = workdir();
	const names = [];
	for (const v of ["0.5.1", "0.5.2", "0.5.3", "0.5.4", "0.5.5"]) {
		const name = `${v}-${HOST}-abc`;
		mkdirSync(join(cache, name));
		writeFileSync(
			join(cache, name, ".complete"),
			JSON.stringify({ version: v, target: HOST, sha256: "abc" }),
		);
		names.push(name);
	}
	mkdirSync(join(cache, "0.5.1-other-x"));
	writeFileSync(
		join(cache, "0.5.1-other-x", ".complete"),
		JSON.stringify({ version: "0.5.1", target: "other-x" }),
	);
	for (const [n, age] of [
		[".staging-old", 2],
		[".staging-new", 0],
	]) {
		mkdirSync(join(cache, n));
		const t = new Date(Date.now() - age * 3_600_000);
		utimesSync(join(cache, n), t, t);
	}
	const removed = prune(cache, HOST, [
		join(cache, names[4]),
		join(cache, names[3]),
	]);
	assert.deepEqual(
		removed.sort(),
		[".staging-old", names[0], names[1], names[2]].sort(),
	);
	assert.deepEqual(
		readdirSync(cache).sort(),
		[".staging-new", "0.5.1-other-x", names[3], names[4]].sort(),
	);
});

test("unsupported platforms are named before anything downloads", () => {
	assert.deepEqual(
		detectTarget({
			platform: "linux",
			arch: "x64",
			glibc: "2.39",
			lddVersion: () => ({ stdout: "ldd (GNU libc) 2.39" }),
		}),
		{ target: "linux-x64" },
	);
	const musl = detectTarget({
		platform: "linux",
		arch: "x64",
		glibc: undefined,
		lddVersion: () => ({ stderr: "musl libc (x86_64)" }),
	});
	assert.match(
		musl.error,
		/no PrismaLens build for linux-x64 with musl libc \(Alpine\)\. Builds exist for darwin-arm64, darwin-x64, linux-arm64, linux-x64, win32-x64\. Run it on a glibc Linux/,
	);
	const arm = detectTarget({ platform: "win32", arch: "arm64" });
	assert.match(
		arm.error,
		/no PrismaLens build for win32-arm64\. Builds exist for .*win32-x64\. Run it on one of those machines, in a container/,
	);
	assert.deepEqual(TARGETS, [
		"darwin-arm64",
		"darwin-x64",
		"linux-arm64",
		"linux-x64",
		"win32-x64",
	]);
});

test("a mirror URL must be https: or file:, and its credentials never reach the output", async () => {
	assert.throws(
		() => parseBase("http://mirror.local/x"),
		/must be an https: or file: URL, not http:/,
	);
	const parsed = parseBase("https://user:S3CRET-T0KEN@mirror.local/x/");
	assert.equal(parsed.base, "https://mirror.local/x");
	assert.equal(
		parsed.auth,
		`Basic ${Buffer.from("user:S3CRET-T0KEN").toString("base64")}`,
	);

	const { bin, mirror, cache } = setup();
	release(mirror, "0.5.6");
	const auths = [];
	const srv = await httpsServer((req, res) => {
		auths.push(req.headers.authorization ?? null);
		if (
			req.headers.authorization !==
			`Basic ${Buffer.from("user:S3CRET-T0KEN").toString("base64")}`
		)
			return res.writeHead(401).end();
		serveDir(mirror)(req, res);
	});
	servers.push(srv);
	const base = srv.url.replace("https://", "https://user:S3CRET-T0KEN@");
	const env = {
		PRISMALENS_LAUNCHER_DIR: cache,
		NODE_EXTRA_CA_CERTS: tlsCert().file,
	};
	const ok = await launch(bin, ["--exit", "0"], {
		...env,
		PRISMALENS_RELEASE_BASE_URL: base,
	});
	assert.equal(ok.status, 0, ok.stderr);
	assert.ok(auths.every((a) => a?.startsWith("Basic ")));
	const bad = await launch(
		bin,
		["--launcher-switch", "nightly", "--version", "0.5.9-nightly.1.1"],
		{ ...env, PRISMALENS_RELEASE_BASE_URL: base },
	);
	assert.equal(bad.status, 1);
	assert.match(
		bad.stderr,
		/https:\/\/127\.0\.0\.1:\d+\/v0\.5\.9-nightly\.1\.1\/SHA256SUMS does not exist/,
	);
	for (const r of [ok, bad]) assert.doesNotMatch(r.stdout + r.stderr, /S3CRET/);
	const plain = await launch(bin, [], {
		...env,
		PRISMALENS_RELEASE_BASE_URL: "http://user:S3CRET-T0KEN@127.0.0.1:9/x",
	});
	assert.equal(plain.status, 1);
	assert.match(plain.stderr, /must be an https: or file: URL, not http:/);
	assert.doesNotMatch(plain.stderr, /S3CRET/);
});

test("a redirect to plain http is refused, so an http hop cannot swap the archive", async () => {
	const { bin, cache } = setup();
	const srv = await httpsServer((req, res) =>
		res.writeHead(302, { location: `http://127.0.0.1:9${req.url}` }).end(),
	);
	servers.push(srv);
	const r = await launch(bin, [], {
		PRISMALENS_LAUNCHER_DIR: cache,
		PRISMALENS_RELEASE_BASE_URL: srv.url,
		NODE_EXTRA_CA_CERTS: tlsCert().file,
	});
	assert.equal(r.status, 1);
	assert.match(r.stderr, /redirected to a http: URL; only https is followed/);
	assert.equal(readPointer(cache, HOST), null);
});

test("429 with Retry-After is waited out", async () => {
	assert.equal(retryAfterMs("2"), 2000);
	assert.equal(
		retryAfterMs(new Date(Date.now() + 3000).toUTCString(), Date.now()) > 1000,
		true,
	);
	const { bin, mirror, cache } = setup();
	release(mirror, "0.5.6");
	let refused = 0;
	const srv = await httpsServer((req, res) => {
		if (req.url.endsWith("SHA256SUMS") && refused++ === 0)
			return res.writeHead(429, { "retry-after": "2" }).end();
		serveDir(mirror)(req, res);
	});
	servers.push(srv);
	const r = await launch(bin, ["--exit", "0"], {
		PRISMALENS_LAUNCHER_DIR: cache,
		PRISMALENS_RELEASE_BASE_URL: srv.url,
		NODE_EXTRA_CA_CERTS: tlsCert().file,
	});
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stderr, /answered 429; retrying in 2\.0s/);
	assert.ok(r.ms >= 2000, `took ${r.ms}ms`);
});

test("downloads go through HTTPS_PROXY", async () => {
	const { bin, mirror, cache } = setup();
	release(mirror, "0.5.6");
	const srv = await httpsServer(serveDir(mirror));
	servers.push(srv);
	const tunnels = [];
	const proxy = net.createServer();
	proxy.on("connection", (client) => {
		client.on("error", () => {});
		client.once("data", (head) => {
			const m = /^CONNECT ([^ ]+) HTTP/.exec(head.toString());
			if (!m) return client.end("HTTP/1.1 405 No\r\n\r\n");
			tunnels.push(m[1]);
			const [host, port] = m[1].split(":");
			const up = net.connect(
				Number(port),
				host === "localhost" ? "127.0.0.1" : host,
				() => {
					client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
					up.pipe(client);
					client.pipe(up);
				},
			);
			up.on("error", () => client.destroy());
		});
	});
	await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
	servers.push(proxy);
	const r = await launch(bin, ["--exit", "0"], {
		PRISMALENS_LAUNCHER_DIR: cache,
		PRISMALENS_RELEASE_BASE_URL: srv.url.replace("127.0.0.1", "localhost"),
		NODE_EXTRA_CA_CERTS: tlsCert().file,
		HTTPS_PROXY: `http://127.0.0.1:${proxy.address().port}`,
		NO_PROXY: "",
	});
	assert.equal(r.status, 0, r.stderr);
	assert.ok(tunnels.length >= 2, `tunnels: ${tunnels}`);
	assert.ok(tunnels.every((t) => t === `localhost:${new URL(srv.url).port}`));
});

test("npm's proxy, noproxy and cafile stand in when the environment sets none", async () => {
	const { networkSettings } = await import("./launcher.mjs");
	const npm = () => ({
		"https-proxy": "http://proxy.corp:3128",
		noproxy: ".corp",
		cafile: "/etc/corp.pem",
	});
	assert.deepEqual(networkSettings({}, npm), {
		HTTPS_PROXY: "http://proxy.corp:3128",
		HTTP_PROXY: "http://proxy.corp:3128",
		NO_PROXY: ".corp",
		NODE_EXTRA_CA_CERTS: "/etc/corp.pem",
	});
	let asked = 0;
	const counted = () => {
		asked++;
		return npm();
	};
	assert.deepEqual(
		networkSettings(
			{ HTTPS_PROXY: "http://env:1", NODE_EXTRA_CA_CERTS: "/env.pem" },
			counted,
		),
		{
			HTTPS_PROXY: "http://env:1",
			HTTP_PROXY: "http://env:1",
		},
	);
	assert.equal(asked, 0, "npm was asked although the environment set both");
});

test("an unreachable github.com names the proxy and the mirror variable", async () => {
	const { bin, cache } = setup();
	const r = await launch(bin, [], {
		PRISMALENS_LAUNCHER_DIR: cache,
		HTTPS_PROXY: "http://127.0.0.1:9",
		PRISMALENS_LAUNCHER_TIMEOUT_SECONDS: "3",
	});
	assert.equal(r.status, 1);
	assert.match(
		r.stderr,
		/couldn't reach github\.com .*set HTTPS_PROXY.*set PRISMALENS_RELEASE_BASE_URL to a mirror of https:\/\/github\.com\/prismalens\/prismalens\/releases\/download; pl --launcher-help shows how/,
	);
	const help = await launch(bin, ["--launcher-help"], {
		PRISMALENS_LAUNCHER_DIR: cache,
	});
	assert.match(
		help.stdout,
		/generic remote repository whose URL is\n\s+https:\/\/github\.com\/prismalens\/prismalens\/releases\/download/,
	);
	assert.match(
		help.stdout,
		/PRISMALENS_RELEASE_BASE_URL=https:\/\/<host>\/artifactory\/<that-repository>/,
	);
});

test("signals reach the app exactly once, from the group or from the launcher alone", {
	skip: WIN && "POSIX process groups",
}, async () => {
	const { dir, bin, mirror, cache } = setup();
	const { url } = release(mirror, "0.5.6");
	const env = {
		PRISMALENS_LAUNCHER_DIR: cache,
		PRISMALENS_RELEASE_BASE_URL: url,
	};
	assert.equal((await launch(bin, ["--exit", "0"], env)).status, 0);
	for (const how of ["group", "launcher", "hangup"]) {
		const log = join(dir, `${how}.log`);
		let child;
		const done = launch(bin, ["--signals", log], env, {
			detached: true,
			onSpawn: (c) => {
				child = c;
			},
		});
		for (
			let i = 0;
			i < 100 &&
			!(existsSync(log) && readFileSync(log, "utf8").includes("ready"));
			i++
		)
			await new Promise((r) => setTimeout(r, 50));
		process.kill(
			how === "group" ? -child.pid : child.pid,
			how === "hangup" ? "SIGHUP" : "SIGTERM",
		);
		const r = await done;
		// The group reaches the app as SIGTERM; the launcher alone, as its one stop request.
		assert.deepEqual(
			readFileSync(log, "utf8").trim().split("\n"),
			["ready", how === "group" ? "SIGTERM" : "stop request", "clean"],
			how,
		);
		assert.equal(r.status, 143, `${how}: ${r.stderr}`);
	}
	// A second deliberate signal to the group still forces the exit.
	const log = join(dir, "twice.log");
	let child;
	const done = launch(bin, ["--signals", log], env, {
		detached: true,
		onSpawn: (c) => {
			child = c;
		},
	});
	for (
		let i = 0;
		i < 100 &&
		!(existsSync(log) && readFileSync(log, "utf8").includes("ready"));
		i++
	)
		await new Promise((r) => setTimeout(r, 50));
	process.kill(-child.pid, "SIGINT");
	await new Promise((r) => setTimeout(r, 300));
	process.kill(-child.pid, "SIGINT");
	const r = await done;
	assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), [
		"ready",
		"SIGINT",
		"forced",
	]);
	assert.equal(r.status, 99);
});

test("a command that ends on its own still exits with the IPC channel open", async () => {
	const { bin, mirror, cache } = setup();
	const { url } = release(mirror, "0.5.6");
	const r = await launch(bin, ["--exit", "3"], {
		PRISMALENS_LAUNCHER_DIR: cache,
		PRISMALENS_RELEASE_BASE_URL: url,
	});
	assert.equal(r.status, 3);
	assert.ok(r.ms < 30_000);
});

test("a pinned digest is the only one that installs: a release swapped with its SHA256SUMS is refused", async () => {
	const dir = workdir();
	const mirror = join(dir, "mirror");
	const real = release(mirror, "0.5.6");
	const pinned = sha256(readFileSync(join(mirror, "v0.5.6", real.name)));
	const bin = installLauncher(join(dir, "pkg"), "0.5.6", { [HOST]: pinned });
	const env = {
		PRISMALENS_LAUNCHER_DIR: join(dir, "cache"),
		PRISMALENS_RELEASE_BASE_URL: real.url,
	};
	rmSync(join(mirror, "v0.5.6", "SHA256SUMS"));
	const ok = await launch(bin, ["--exit", "0"], env);
	assert.equal(ok.status, 0, `the pin alone did not suffice: ${ok.stderr}`);
	rmSync(join(mirror, "v0.5.6"), { recursive: true });
	release(mirror, "0.5.6", { migrations: ["20260901000000_init", "swapped"] });
	const swapped = await launch(bin, ["--exit", "0"], {
		...env,
		PRISMALENS_LAUNCHER_DIR: join(dir, "cache-2"),
	});
	assert.equal(swapped.status, 1);
	assert.match(
		swapped.stderr,
		new RegExp(
			`checksum mismatch .* \\(the digest npm's launcher pins says ${pinned}, the download is [0-9a-f]{64}\\); nothing was installed`,
		),
	);
});

test("a nightly whose release changed after it was verified is not reinstalled", async () => {
	const { bin, mirror, cache } = setup();
	release(mirror, "0.5.6");
	const { url } = release(mirror, "0.5.7-nightly.20261117.3");
	const env = {
		PRISMALENS_LAUNCHER_DIR: cache,
		PRISMALENS_RELEASE_BASE_URL: url,
	};
	assert.equal(
		(
			await launch(
				bin,
				[
					"--launcher-switch",
					"nightly",
					"--version",
					"0.5.7-nightly.20261117.3",
				],
				env,
			)
		).status,
		0,
	);
	const verified = readPointer(cache, HOST).current;
	rmSync(join(cache, verified.dir), { recursive: true });
	rmSync(join(mirror, "v0.5.7-nightly.20261117.3"), { recursive: true });
	release(mirror, "0.5.7-nightly.20261117.3", { migrations: ["other"] });
	const r = await launch(bin, ["--exit", "0"], env);
	assert.equal(r.status, 1);
	assert.match(
		r.stderr,
		new RegExp(
			`v0.5.7-nightly.20261117.3's SHA256SUMS now lists .* but this copy verified 0.5.7-nightly.20261117.3 for ${HOST} as ${verified.sha256}; nothing was installed`,
		),
	);
});

test("a lock left by a dead launcher, or one with no pid, does not block the next start", async () => {
	const { bin, mirror, cache } = setup();
	const { url } = release(mirror, "0.5.6");
	mkdirSync(join(cache, `.lock-0.5.6-${HOST}`), { recursive: true });
	const dead = { ...ownerRecord(), pid: 999999 };
	writeFileSync(
		join(cache, `.lock-0.5.6-${HOST}`, dead.token),
		JSON.stringify(dead),
	);
	mkdirSync(join(cache, `.lock-pointer-${HOST}`));
	const old = new Date(Date.now() - 120_000);
	utimesSync(join(cache, `.lock-pointer-${HOST}`), old, old);
	const r = await launch(bin, ["--exit", "0"], {
		PRISMALENS_LAUNCHER_DIR: cache,
		PRISMALENS_RELEASE_BASE_URL: url,
		PRISMALENS_LAUNCHER_TIMEOUT_SECONDS: "20",
	});
	assert.equal(r.status, 0, r.stderr);
	assert.ok(r.ms < 15_000, `took ${r.ms}ms`);
});

test("prune keeps a runtime a live launcher is running", () => {
	const cache = workdir();
	for (const v of ["0.5.4", "0.5.5"]) {
		mkdirSync(join(cache, `${v}-${HOST}-abc`, ".leases"), { recursive: true });
		writeFileSync(
			join(cache, `${v}-${HOST}-abc`, ".complete"),
			JSON.stringify({ version: v, target: HOST, sha256: "abc" }),
		);
	}
	writeFileSync(
		join(cache, `0.5.4-${HOST}-abc`, ".leases", "live"),
		JSON.stringify(ownerRecord()),
	);
	writeFileSync(
		join(cache, `0.5.5-${HOST}-abc`, ".leases", "dead"),
		JSON.stringify({ ...ownerRecord(), pid: 999999 }),
	);
	assert.deepEqual(prune(cache, HOST, []), [`0.5.5-${HOST}-abc`]);
});

test("prune never removes a lock its holder still holds, however long it has held it", () => {
	const cache = workdir();
	const old = new Date(Date.now() - 2 * 60 * 60_000);
	for (const [name, owner] of [
		["held", ownerRecord()],
		["gone", { ...ownerRecord(), pid: 999999 }],
	]) {
		const dir = join(cache, `.lock-${name}-${HOST}`);
		mkdirSync(dir);
		writeFileSync(join(dir, owner.token), JSON.stringify(owner));
		utimesSync(dir, old, old);
	}
	assert.deepEqual(prune(cache, HOST, []), [`.lock-gone-${HOST}`]);
});

test("cr-prune: prune paused after its stale check never removes the lock a launcher took meanwhile", () => {
	const cache = workdir();
	const lock = join(cache, `.lock-0.5.6-${HOST}`);
	// A runtime lock whose holder died, untouched for two hours.
	const gone = tryLock(lock);
	writeFileSync(
		join(lock, gone),
		JSON.stringify({ ...ownerRecord(gone), pid: 999999 }),
	);
	const old = new Date(Date.now() - 2 * 60 * 60_000);
	utimesSync(join(lock, gone), old, old);
	utimesSync(lock, old, old);
	// Prune pauses at its removal; meanwhile a launcher breaks the stale lock and takes it.
	const { rmSync: rm, unlinkSync: unlink } = fsModule;
	let fired = false;
	let next = null;
	const meanwhile = (target) => {
		if (fired || (target !== lock && !target.startsWith(`${lock}${sep}`)))
			return;
		fired = true;
		breakLock(lock, lockHolder(lock).token);
		next = tryLock(lock);
	};
	fsModule.rmSync = (target, opts) => {
		meanwhile(String(target));
		return rm(target, opts);
	};
	fsModule.unlinkSync = (target) => {
		meanwhile(String(target));
		return unlink(target);
	};
	try {
		prune(cache, HOST, []);
	} finally {
		fsModule.rmSync = rm;
		fsModule.unlinkSync = unlink;
	}
	assert.ok(next);
	assert.equal(
		lockHolder(lock).token,
		next,
		"prune removed the lock a launcher took meanwhile",
	);
});

test("finding 6: a reused pid holds nothing once its owner's heartbeat stops", async () => {
	const { bin, mirror, cache } = setup();
	const { url } = release(mirror, "0.5.6");
	// The pid is alive (this test runs as it) but no holder has touched the lock for 2 minutes.
	const lockDir = join(cache, `.lock-0.5.6-${HOST}`);
	mkdirSync(lockDir, { recursive: true });
	const reused = ownerRecord();
	writeFileSync(join(lockDir, reused.token), JSON.stringify(reused));
	const old = new Date(Date.now() - 120_000);
	utimesSync(join(lockDir, reused.token), old, old);
	const r = await launch(bin, ["--exit", "0"], {
		PRISMALENS_LAUNCHER_DIR: cache,
		PRISMALENS_RELEASE_BASE_URL: url,
		PRISMALENS_LAUNCHER_TIMEOUT_SECONDS: "20",
	});
	assert.equal(r.status, 0, r.stderr);
	assert.ok(r.ms < 15_000, `took ${r.ms}ms`);

	const keep = workdir();
	for (const [name, age] of [
		["fresh", 0],
		["reused", 120_000],
	]) {
		const dir = join(keep, `0.5.${name === "fresh" ? 4 : 5}-${HOST}-abc`);
		mkdirSync(join(dir, ".leases"), { recursive: true });
		writeFileSync(
			join(dir, ".complete"),
			JSON.stringify({ version: "x", target: HOST }),
		);
		writeFileSync(join(dir, ".leases", name), JSON.stringify(ownerRecord()));
		const t = new Date(Date.now() - age);
		utimesSync(join(dir, ".leases", name), t, t);
	}
	assert.deepEqual(prune(keep, HOST, []), [`0.5.5-${HOST}-abc`]);
	assert.equal(
		holds({ ...ownerRecord(), host: "another-machine" }, Date.now()),
		true,
	);
	assert.equal(
		holds({ ...ownerRecord(), host: "another-machine" }, Date.now() - 120_000),
		false,
	);
});
