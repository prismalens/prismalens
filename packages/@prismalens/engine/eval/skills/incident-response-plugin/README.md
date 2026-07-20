# incident-response-plugin (vendored)

A local Claude Code plugin that packages Anthropic's official **incident-response**
skill, loaded IDENTICALLY into both arms of the PrismaLens Phase-2 paired A/B eval
(#68 Half A). Loading the same skill into both arms is what makes the eval a *clean
ablation*: the only variable between arm (a) "raw" and arm (b) "prismalens" is the
PrismaLens supervisor overlay, not the skill.

## What is vendored — ATTRIBUTION

- **Skill:** `incident-response` (`skills/incident-response/SKILL.md`)
- **Source:** [`anthropics/knowledge-work-plugins`](https://github.com/anthropics/knowledge-work-plugins)
  — Anthropic's official open-source plugin repository ("plugins primarily intended for
  knowledge workers to use in Claude Cowork").
- **Source path:** `engineering/skills/incident-response/SKILL.md`
- **Source URL:** https://github.com/anthropics/knowledge-work-plugins/blob/main/engineering/skills/incident-response/SKILL.md
- **Vendored from commit:** `2d6f7e22dd25593f0f748010430ef86f19659735` (file's last change, 2026-03-13)
- **Repo HEAD at vendoring time:** `1a69f0ca3c77f8108dfeecf7e38262889ed0215c`
- **Retrieved:** 2026-07-19
- **License:** Apache-2.0 (same as this repository) — see the upstream `LICENSE`.

`SKILL.md` is the upstream content **verbatim**. Only this plugin wrapper
(`.claude-plugin/plugin.json` + the `skills/` directory layout) was added so the
`@anthropic-ai/claude-agent-sdk` `query()` call can load it as a `{ type: 'local' }`
plugin.

## Why this is the right skill

It is Anthropic's own, canonically-published incident-response Agent Skill (not a
third-party or hand-rolled one), it is Apache-2.0 (freely redistributable), and its
frontmatter `description` triggers exactly on the on-call situation this eval creates —
"an alert that needs severity assessment", "production is down". It gives the agent a
real incident-response methodology (triage → communicate → mitigate → postmortem, 5-whys
RCA) without prescribing a specific root cause, so it aids BOTH arms equally.

## Known caveat

The upstream `SKILL.md` opens with a relative link to `../../CONNECTORS.md` (a file that
lives at the root of the upstream plugin bundle, not vendored here). The link is advisory
documentation only — it does not affect skill loading or the eval — and is preserved
verbatim rather than edited, to keep the vendored content faithful to the source.

## How it is loaded

Both arms pass, into the Agent SDK `query()` options:

```ts
native: {
  plugins: [{ type: "local", path: "<abs path to this dir>" }],
  skills: ["incident-response"],
}
```

`plugins` loads via the `query()` option independently of `settingSources`, so the skill
is present even under `isolateSettings: true` (which is what keeps the host's own
settings/skills out of the eval).
