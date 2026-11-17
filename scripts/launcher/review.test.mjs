// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The launcher against the failures adversary round 2 reproduced on #1165 (#717): a runtime
// pruned before its pointer moved, a crashed install's staging dir run as a runtime, a warm
// cache bypassing the manifest pin, a damaged entry point run as if whole, and npm's proxy
// and CA settings lost to `npm config get` refusing protected keys.
import assert from "node:assert/strict";
import {
	existsSync,
	readFileSync,
	renameSync,
	truncateSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
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
import { parseNpmrc, readPointer } from "./launcher.mjs";

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
	assert.match(
		repaired.stderr,
		/moved .*\.damaged-\d+ aside\nprismalens: repaired stable 0\.5\.6 in /,
	);
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
			cafile: "/etc/ssl/corp.pem",
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
