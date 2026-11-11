# prismalens

## [0.5.5](https://github.com/prismalens/prismalens/compare/v0.5.4...v0.5.5) (2026-11-11)


### Features

* ship a nightly channel beside stable, and let installs choose one ([#1086](https://github.com/prismalens/prismalens/issues/1086)) ([1c61bff](https://github.com/prismalens/prismalens/commit/1c61bff7c5fff50dd5fa7eb54efdd1ecf343aed8))

## [0.5.4](https://github.com/prismalens/prismalens/compare/v0.5.3...v0.5.4) (2026-11-11)


### Features

* **#930:** the agent records evidence and hypotheses through PrismaLens's tool as it works ([9ed0630](https://github.com/prismalens/prismalens/commit/9ed0630d1bee1accc6aed2cfeb6f9c0719bff1d1))
* **#930:** the agent records evidence and hypotheses through PrismaLens's tool as it works ([75a912f](https://github.com/prismalens/prismalens/commit/75a912fdbc2dcf0c806894a75d461f926cedd5cd))
* **#931:** an integrated terminal on the host, and Run in terminal for commands ([1cec6c6](https://github.com/prismalens/prismalens/commit/1cec6c6db32c546838f7b5066372c37a08875610))
* **#931:** desktop terminal key and unpacked node-pty; lint ([f6168f6](https://github.com/prismalens/prismalens/commit/f6168f6a34b09e083ffe4204646fc9bf6aa27ef5))
* **#931:** terminal key, local-request gate, socket server and contract ([416343a](https://github.com/prismalens/prismalens/commit/416343aa7c830570cdcf135e97fd14183620ed97))
* **#931:** terminal panel, Run in terminal, redirect-file opener, key on pairing ([d392e09](https://github.com/prismalens/prismalens/commit/d392e09169cdf73786642529934bd525f0cf0c8a))
* **#942:** a follow-up reopens by session/resume, an end marker or id dedupe, or a fresh session ([21bbbca](https://github.com/prismalens/prismalens/commit/21bbbcaea55759a99bf4061b2526587342c01111))
* **#942:** a follow-up reopens by session/resume, an end marker or id dedupe, or a fresh session ([b2b3cc0](https://github.com/prismalens/prismalens/commit/b2b3cc0c15eb8915dd1fd5bdea85af4aafa62237))
* **#976:** mount the terminal in the bottom panel, with Ctrl+` and a sidebar door ([7d777d3](https://github.com/prismalens/prismalens/commit/7d777d331c3413cd7cb754a6e26a9b0e62fe4f7e))
* **#981:** a live run a restart cut off reads Resumed after a restart in Working ([72340d0](https://github.com/prismalens/prismalens/commit/72340d05dc2cb312023f30b93eba7e81cc151699))
* **#981:** restart recovery contracts, the Resume after a restart setting, pid hook, PrismaLens-authored restart messages in handoffs ([0064307](https://github.com/prismalens/prismalens/commit/0064307096cbd630ccb5e98b4c8f7fa895957672))
* **#981:** runs a restart cut off carry on where they were, or wait with the reason ([2c62d16](https://github.com/prismalens/prismalens/commit/2c62d16c0e5e9e0dc105b91ea358c0724d061952))
* **api:** a cancelled caller's cards close through the asks seat ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([1368d8c](https://github.com/prismalens/prismalens/commit/1368d8c3e3056d8bf15623011ece183d59e25746))
* **api:** a finding links a service check to an incident ([#979](https://github.com/prismalens/prismalens/issues/979)) ([063ec3f](https://github.com/prismalens/prismalens/commit/063ec3fa6d334f7e6a08f1413cf44400282afc5c))
* **api:** a service check runs from its service, frozen repositories and brief ([#979](https://github.com/prismalens/prismalens/issues/979)) ([205da9b](https://github.com/prismalens/prismalens/commit/205da9b95672289756782a8a5145d1ac2a8fb446))
* **api:** a thread tree pages as one block, and rows carry their place in it ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([5550ca9](https://github.com/prismalens/prismalens/commit/5550ca9780e22e5272eb5ae26a07f25ed7b3142d))
* **api:** carry the recurrence and schedule-text helpers in [#983](https://github.com/prismalens/prismalens/issues/983) so [#984](https://github.com/prismalens/prismalens/issues/984) stacks on them ([f4e122e](https://github.com/prismalens/prismalens/commit/f4e122e80760b92d60acfedd2a68ecabc35fcfce))
* **api:** null-safe reads and refusals for a run with no incident ([#979](https://github.com/prismalens/prismalens/issues/979)) ([41922eb](https://github.com/prismalens/prismalens/commit/41922ebcca546a6f8ca585fc46336fc16efbc801))
* **api:** observe() runs the heartbeat's sleep check now, synchronously ([#979](https://github.com/prismalens/prismalens/issues/979)) ([3058c31](https://github.com/prismalens/prismalens/commit/3058c311f4bd4052c6b3cbe6f3fa2b85f143e21d))
* **api:** one startup step records when PrismaLens last ran and the gaps since ([#981](https://github.com/prismalens/prismalens/issues/981), [#979](https://github.com/prismalens/prismalens/issues/979)) ([ac7c7d0](https://github.com/prismalens/prismalens/commit/ac7c7d0fbcd9c639325a05d18678449714969f5c))
* **api:** one startup step records when PrismaLens last ran and the gaps since ([#981](https://github.com/prismalens/prismalens/issues/981), [#979](https://github.com/prismalens/prismalens/issues/979)) ([bcf1c61](https://github.com/prismalens/prismalens/commit/bcf1c612c682891ceb4460b3cb3c1729e65dde8a))
* **api:** scope runs with no incident by schedule ([#979](https://github.com/prismalens/prismalens/issues/979)) ([ae87416](https://github.com/prismalens/prismalens/commit/ae87416864a1718923c786a3d39861f328f2fb8e))
* **api:** the panel lists a recorded commit's tree and diffs a commit pair the run recorded at start ([#973](https://github.com/prismalens/prismalens/issues/973)) ([d315692](https://github.com/prismalens/prismalens/commit/d315692ea4f77852ef979bb527f00e6a83c66320))
* **api:** thread trees, durable act approvals and proposals ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([07f4e24](https://github.com/prismalens/prismalens/commit/07f4e24f23d4fd8702ec3a20984e57c9d47b4121))
* **api:** wire the act gate to the asks seat; regenerate the thread_tree migration on the composer base ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([e2c546e](https://github.com/prismalens/prismalens/commit/e2c546ebb664ba76d6a21af34be950c9978372fb))
* **app:** agents wake their thread later and watch pull requests; # finds the git hosts' issues and pull requests ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([40b5fbf](https://github.com/prismalens/prismalens/commit/40b5fbfc22d3c24eb6941884334ded40a2b5c14f))
* **app:** agents wake their thread later, watch pull requests, and # finds issues and PRs ([6d4c909](https://github.com/prismalens/prismalens/commit/6d4c909749565a872cf2bd07bfaa7b3b24b67f68))
* **app:** agents wake their thread later, watch pull requests, and # finds issues and PRs ([#1072](https://github.com/prismalens/prismalens/issues/1072)) ([6d4c909](https://github.com/prismalens/prismalens/commit/6d4c909749565a872cf2bd07bfaa7b3b24b67f68))
* **app:** composer, search palette, add a project, title row, folder hardening and schedules ([#1020](https://github.com/prismalens/prismalens/issues/1020)) ([#1044](https://github.com/prismalens/prismalens/issues/1044)) ([bac765b](https://github.com/prismalens/prismalens/commit/bac765bbd2524438528ee90a5dec3893e012fa5f))
* **app:** first turn, words and tools that follow the thread ([#1039](https://github.com/prismalens/prismalens/issues/1039)) ([75987b4](https://github.com/prismalens/prismalens/commit/75987b4caebafa9c3465dd102f5f866f52bbf318))
* **app:** helper threads on empty pages, and a plain answer to a plain greeting ([#1033](https://github.com/prismalens/prismalens/issues/1033)) ([c318e0d](https://github.com/prismalens/prismalens/commit/c318e0df1d728eb25a7b06348017c9625de3acd9))
* **app:** install and restart from the app, project logos, and add a project from a git host ([af0ddd1](https://github.com/prismalens/prismalens/commit/af0ddd1fe0e3a2116e2345383edc9a0897031682))
* **app:** install and restart from the app, update controls and diagnostics ([#724](https://github.com/prismalens/prismalens/issues/724)) ([8de0dea](https://github.com/prismalens/prismalens/commit/8de0dea2b91d42b5dd52d0183c1b1d40448158f0))
* **app:** PR author, reviewer and check-run avatars go through the image proxy ([97bec97](https://github.com/prismalens/prismalens/commit/97bec97ede3795e3bc59cba03e3549ee9393c1af))
* **app:** project logos, one image proxy and add a project from a git host ([d0aa851](https://github.com/prismalens/prismalens/commit/d0aa851dd6d9792aa6528283d70620a18fd5c7c9))
* **app:** project threads end to end ([#1027](https://github.com/prismalens/prismalens/issues/1027)) ([5bf13e4](https://github.com/prismalens/prismalens/commit/5bf13e41f598f305d19f42e35bd656327dc9e2cf))
* **app:** sub-agents in a thread, and tools that ask, wait and watch ([211d5c8](https://github.com/prismalens/prismalens/commit/211d5c88a46c870608c8e132202ebb0eef3ac07b))
* **app:** sub-agents in a thread, and tools that ask, wait and watch ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([a97c967](https://github.com/prismalens/prismalens/commit/a97c9675d8168d24c99dc811e16ca6e466271164))
* **app:** thread list and the new entry points ([#1020](https://github.com/prismalens/prismalens/issues/1020)) ([#1029](https://github.com/prismalens/prismalens/issues/1029)) ([48ffe7c](https://github.com/prismalens/prismalens/commit/48ffe7ce5b7cedb21ba54e5a3eb2b9a1706fce54))
* **app:** thread titles, Scheduled prompts in Settings, services for projects ([#1031](https://github.com/prismalens/prismalens/issues/1031)) ([fa4d1d0](https://github.com/prismalens/prismalens/commit/fa4d1d0b4416a61a5b102a6eb1c522de07534c8c))
* **app:** watch a thread work, and harden project threads ([#1028](https://github.com/prismalens/prismalens/issues/1028)) ([9685644](https://github.com/prismalens/prismalens/commit/968564491bbd35877355766533f80fbf90bea628))
* **asks:** a tool's ask is held by AsksService, outliving its run and a restart ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([b9810f1](https://github.com/prismalens/prismalens/commit/b9810f12a675572366213d41d6aef1269cb23cce))
* **asks:** close a cancelled caller's tool ask, once ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([b4baaee](https://github.com/prismalens/prismalens/commit/b4baaeeea8cafc47a93f199750c90d37f90bd62a))
* **composer:** drafts, references, one pending-ask shape and agent questions ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([66d2fd2](https://github.com/prismalens/prismalens/commit/66d2fd2a8e3f6427b26d058ea557f25641131d71))
* **config:** tool search on for codex too ([#848](https://github.com/prismalens/prismalens/issues/848)) ([fd2fc9a](https://github.com/prismalens/prismalens/commit/fd2fc9a08712f2d0ca36ea5bc0a6d293a4b2bfba))
* **config:** tool search on for opencode, claude-code, gemini and deepagents; the cost count sees codex's namespace ([#848](https://github.com/prismalens/prismalens/issues/848)) ([12e369e](https://github.com/prismalens/prismalens/commit/12e369e029b44426c67d6826726d2351b82aaf67))
* **contracts:** pending asks, composer drafts and reference search contracts ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([c4a0603](https://github.com/prismalens/prismalens/commit/c4a0603247f46e8aeed838a187176c9741db3639))
* **database:** composer drafts, reference uses and agent commands ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([758a828](https://github.com/prismalens/prismalens/commit/758a828dbddb397612a6814313f0c0507a7ea5f4))
* **dispatch:** boot takes up the runs a restart cut off, in one transaction, or says why not ([#981](https://github.com/prismalens/prismalens/issues/981)) ([ac4133c](https://github.com/prismalens/prismalens/commit/ac4133cdb6da53aa8d427541239c1eecec49ae89))
* **engine:** a service-check mode for the context and the prompt ([#979](https://github.com/prismalens/prismalens/issues/979)) ([e241e24](https://github.com/prismalens/prismalens/commit/e241e24ba6fecee96ec08baa5737b03031459291))
* **engine:** the permission policy answers only read and record gateway tools without a card ([#848](https://github.com/prismalens/prismalens/issues/848)) ([a4d60b4](https://github.com/prismalens/prismalens/commit/a4d60b45784e4c3deb496688ce991f627c6bd800))
* **frontend:** a generic-first shell with Threads, Automation, Recents and Waiting for you ([#1049](https://github.com/prismalens/prismalens/issues/1049)) ([306a4ce](https://github.com/prismalens/prismalens/commit/306a4ce8b4812c9c42c86501ca1673f72e1dcb9b))
* **frontend:** a generic-first shell: New and Search, Threads, Automation, Recents and Waiting for you ([#1020](https://github.com/prismalens/prismalens/issues/1020)) ([6d2107f](https://github.com/prismalens/prismalens/commit/6d2107f7b96d637e4dc58552276e35a4d9597759))
* **frontend:** a transcript-first thread page with the incident summary above and an Incident tab ([5892653](https://github.com/prismalens/prismalens/commit/5892653d892b4f86b42c3831dd6d3c5e36f70cac))
* **frontend:** a transcript-first thread page with the incident summary above and its cards in an Incident tab ([#1020](https://github.com/prismalens/prismalens/issues/1020)) ([372efa6](https://github.com/prismalens/prismalens/commit/372efa68a9ed0bc798602381db91231bf973ed84))
* **frontend:** agents and editors show their own logos ([#1020](https://github.com/prismalens/prismalens/issues/1020)) ([#1046](https://github.com/prismalens/prismalens/issues/1046)) ([1e55648](https://github.com/prismalens/prismalens/commit/1e55648eef2ab6a0dbdc755654b4b230cabbf571))
* **frontend:** an artifact the agent publishes renders in the run, sandboxed, with Open larger ([#871](https://github.com/prismalens/prismalens/issues/871)) ([04e63b6](https://github.com/prismalens/prismalens/commit/04e63b65f3f9139ded6394bfd87e6ee4c53b1d84))
* **frontend:** Biome holds the look: its Tailwind rules and five plugins replace the grep contracts ([#1020](https://github.com/prismalens/prismalens/issues/1020)) ([87d6718](https://github.com/prismalens/prismalens/commit/87d671814863467f3a26b0ae90f1cea517c1977a))
* **frontend:** Files shows the run's tree beside the file at its commit; Changes shows the recorded pair's diff; the URL holds the tab and file ([#973](https://github.com/prismalens/prismalens/issues/973)) ([4c869f3](https://github.com/prismalens/prismalens/commit/4c869f3a90b767f9ca37f5d5b7a61acfb95fffc5))
* **frontend:** hold the UI to its standard with ui:check, a committed budget and a state gallery ([34e7fe3](https://github.com/prismalens/prismalens/commit/34e7fe39073fbb20e3effda8a611eac912e2fdd9))
* **frontend:** one panel layout for every page; Run details become a resizable right panel ([#973](https://github.com/prismalens/prismalens/issues/973)) ([c1e79ff](https://github.com/prismalens/prismalens/commit/c1e79ff63703e80b1c11f8c91a02acf1d9ec14e4))
* **frontend:** one panel layout for every page; Run details become a resizable right panel ([#973](https://github.com/prismalens/prismalens/issues/973)) ([a1450b5](https://github.com/prismalens/prismalens/commit/a1450b5a9ea1e9a4d85af4dccfa60f5866e2a752))
* **frontend:** show a restart's resume on the run, the board, a startup notice and Settings ([#981](https://github.com/prismalens/prismalens/issues/981)) ([43826ca](https://github.com/prismalens/prismalens/commit/43826ca3ad4aa0e23aed117a0449cda78b28abe4))
* **frontend:** the palette finds an incident with no run by title or number ([#1020](https://github.com/prismalens/prismalens/issues/1020)) ([901b68e](https://github.com/prismalens/prismalens/commit/901b68e4c5cb89f3d6410f82bf1c843f8b1a41e7))
* **frontend:** the UI standard as checks: ui:check, a committed ui-budget, look contracts and a state gallery ([#1020](https://github.com/prismalens/prismalens/issues/1020)) ([23cc9d7](https://github.com/prismalens/prismalens/commit/23cc9d726a8fb8de655ffb82e1d61600f3cf1a37))
* **gateway:** artifact_publish, an HTML page the agent shows in the run ([#871](https://github.com/prismalens/prismalens/issues/871)) ([7655ba7](https://github.com/prismalens/prismalens/commit/7655ba79e695ad2cff68f9a9304f16a948fd5f7d))
* **gateway:** one framework for PrismaLens's agent tools, 13 tools on it, and per-agent tool search ([#848](https://github.com/prismalens/prismalens/issues/848)) ([509316e](https://github.com/prismalens/prismalens/commit/509316e73e5cd5194119355678d3f707f8e2b475))
* **gateway:** one framework for PrismaLens's agent tools, tool search, recorded calls and replay ([#848](https://github.com/prismalens/prismalens/issues/848)) ([2bbca92](https://github.com/prismalens/prismalens/commit/2bbca92effc55ba97626dec50d02fbcc298d9fbe))
* **gateway:** report check, attachments, similar incidents and past fixes for the agent ([#848](https://github.com/prismalens/prismalens/issues/848)) ([6569d26](https://github.com/prismalens/prismalens/commit/6569d265b2fae385727da4a90a107be8f0af5caf))
* **gateway:** thread, timeline, service, change and run-status tools for the agent ([#848](https://github.com/prismalens/prismalens/issues/848)) ([676302d](https://github.com/prismalens/prismalens/commit/676302d4a6dbb76d427cf55b512d40767ee6203b))
* **integrations:** act effect, limit_reached and per-tool timeouts ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([f7ed62f](https://github.com/prismalens/prismalens/commit/f7ed62f201207a62299b7b7ad7f8069faebc4d65))
* scheduled checks run on the host, every device sees them, only the host changes them ([#979](https://github.com/prismalens/prismalens/issues/979)) ([94f8807](https://github.com/prismalens/prismalens/commit/94f88072021b290399df9b487bba8a61666d9838))
* **schedules:** a scheduled run's page shows what the agent did, live ([#979](https://github.com/prismalens/prismalens/issues/979)) ([699c043](https://github.com/prismalens/prismalens/commit/699c043a95ebb5d1c672b052bb249e18de7bfd6b))
* **schedules:** host-only API, the 30 s loop and its proofs ([#979](https://github.com/prismalens/prismalens/issues/979)) ([5c5de38](https://github.com/prismalens/prismalens/commit/5c5de38b8f19cb6079152e3d4a8356ff65c4419b))
* **schedules:** storage, recurrence and contracts for scheduled tasks ([#979](https://github.com/prismalens/prismalens/issues/979)) ([57582a3](https://github.com/prismalens/prismalens/commit/57582a334a1564b283337ac81517189c6805f61b))
* **schedules:** the scheduler decides, admits and expires ticks ([#979](https://github.com/prismalens/prismalens/issues/979)) ([ab97f70](https://github.com/prismalens/prismalens/commit/ab97f7050ea416d3307bff93768143a58b563f84))
* **schedules:** the Schedules door, list, editor, history and a scheduled run's page ([#979](https://github.com/prismalens/prismalens/issues/979)) ([e2e658b](https://github.com/prismalens/prismalens/commit/e2e658b9d1b70b2cdf37fd61f41d4febbceb7b38))
* **session:** a usage limit resumes at its reset, and a cold session picks up cheaply ([1daaac1](https://github.com/prismalens/prismalens/commit/1daaac1ccfe78055c493f2d158e6b137282ec785))
* **session:** a usage limit resumes at its reset, and a cold session picks up cheaply ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([1a62d22](https://github.com/prismalens/prismalens/commit/1a62d22a9a930455447bde2af4363b577ad3dce3))
* **telemetry:** mark internal installs and count only published releases ([d3cc7fa](https://github.com/prismalens/prismalens/commit/d3cc7fa54ab0cdf3616274d6ee6b41c823c0a0b3)), closes [#1021](https://github.com/prismalens/prismalens/issues/1021)
* **telemetry:** mark internal installs and count only published releases ([#1021](https://github.com/prismalens/prismalens/issues/1021)) ([f482612](https://github.com/prismalens/prismalens/commit/f48261244e5a7bf9c43b5926593271425b66b2f2))
* the panel shows the run's files at their commit and the recorded deploy diff ([#973](https://github.com/prismalens/prismalens/issues/973)) ([d6ec856](https://github.com/prismalens/prismalens/commit/d6ec8569fc0f17aa5657d249dd5170843f73aa3b))
* the run panel's Browser tab opens pages in an isolated view in the desktop app, and links in a new tab elsewhere ([#973](https://github.com/prismalens/prismalens/issues/973)) ([cd7b32e](https://github.com/prismalens/prismalens/commit/cd7b32eef2701c4988713760c92d61f4c72350c9))
* the run panel's Browser tab, an isolated view in the desktop app and new-tab links elsewhere ([#973](https://github.com/prismalens/prismalens/issues/973)) ([baf454c](https://github.com/prismalens/prismalens/commit/baf454c21864d4e270c6163f5b9ee00f10119391))
* **threads:** a thread you start can work in your own checkout ([#1066](https://github.com/prismalens/prismalens/issues/1066)) ([58983f3](https://github.com/prismalens/prismalens/commit/58983f3ae632b15a57b1da99a4e06ed504d776ff))
* **threads:** agents start, message and wait on threads behind the host's approval ([7f41659](https://github.com/prismalens/prismalens/commit/7f4165902fd6969be08f63b4964aff3f0d92dc4d))
* **threads:** thread context, pull requests and prose links ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([9d7737b](https://github.com/prismalens/prismalens/commit/9d7737bc9d25bd1f582e87a4bb89a5e3c33d10b2))
* **threads:** thread context, pull requests and prose links (backend) ([10ccf22](https://github.com/prismalens/prismalens/commit/10ccf227228c21d06456864f60aeef82d00c89e2))


### Bug Fixes

* **#930:** adversary round 1 on [#969](https://github.com/prismalens/prismalens/issues/969) ([a592c2d](https://github.com/prismalens/prismalens/commit/a592c2d3cfcfbd86ba55dd9f0b5903d689fbbee3))
* **#931:** a replaced device keeps no old terminal key; a step runs only its raw shell command ([e8ca15c](https://github.com/prismalens/prismalens/commit/e8ca15cdef2fe3ecf1446ae890f8607a30355cba))
* **#931:** CodeRabbit round on the terminal PR: pl up redirect, desktop key claim, step command, paste chunks, tarball budget ([be23413](https://github.com/prismalens/prismalens/commit/be2341349146c784a5f6d3b4478fad90affb47b5))
* **#931:** Codex diff review: WSL opener, malformed upgrade, late frames, revoke cut-off, session cap race, draft kept until sent, focus, openapi ([f223911](https://github.com/prismalens/prismalens/commit/f2239112b86a64c32d96e7eea78829d639269512))
* **#942:** replay is conversation only, R5 reads what the agent re-sent, a fresh session is recorded ([145a974](https://github.com/prismalens/prismalens/commit/145a974f148a1a403f5d74e1f0964bcb59ac0246))
* **#969:** number recorded ids past the highest held, and refuse to record over unread history ([b913588](https://github.com/prismalens/prismalens/commit/b9135881a00b1ccf0ef0ad8364d944338e1571a1))
* **#975:** resolve short or uppercase deploy shas, reset Changes state per run, scroll the tree on path changes only ([1205473](https://github.com/prismalens/prismalens/commit/12054734ba0e9f912c31db85fbf2b5bad8b35246))
* **#976:** a step's command chip shows repo/ and copies the command as it ran ([c2339b5](https://github.com/prismalens/prismalens/commit/c2339b57ed6a03d6b07eebb29978fe2c3a3ecb0e))
* **#976:** Run in terminal closes its dialog and focuses the staged line; a run step's command gets the command chip ([b0fabfd](https://github.com/prismalens/prismalens/commit/b0fabfd5a19c7c38a68b6d9a69cca7b9ea66435b))
* **#977:** all six panel tabs fit a 320 px sheet ([7e79a7c](https://github.com/prismalens/prismalens/commit/7e79a7cb659982db26debc3c068679a3fc1c831a))
* **#977:** the Changes tab test passes the Browser tab's links prop ([f2f65a8](https://github.com/prismalens/prismalens/commit/f2f65a8916b971ebddacc02ff5f8977d4c645cf3))
* **#979:** a deleted service keeps its check runs; the dialog fills a late default agent and Duplicate keeps effort and catch-up ([3e22e61](https://github.com/prismalens/prismalens/commit/3e22e61c7a2b808cf0dc5f1e7b7ef0d7a78878b2))
* **#979:** a seeded schedule keeps its own agent and null model ([1351983](https://github.com/prismalens/prismalens/commit/135198334699f133981175dae22ed761d11c6a42))
* **#979:** deleting a service that has scheduled check runs is refused with 409 ([797ce34](https://github.com/prismalens/prismalens/commit/797ce34954bae40f6444716918d56ac81119825d))
* **#979:** Run once help names the schedule's own catch-up window ([efaeb60](https://github.com/prismalens/prismalens/commit/efaeb60a34c82643c16620f0d8030285e7301e7a))
* **#981:** a crash's gap opens at the run's last event, not a heartbeat a minute early ([85d040c](https://github.com/prismalens/prismalens/commit/85d040c5ca6137e072a40a5bb9d4647d980ea6f9))
* **#981:** a refusal counts as handled only once it, or its parking, is written ([c854c7a](https://github.com/prismalens/prismalens/commit/c854c7a5127371ed201fbad2b31a69c9a767b358))
* **#981:** close round 2's gaps in activity, catch-up, revalidation, waking and receipts ([51622cf](https://github.com/prismalens/prismalens/commit/51622cf858a91dbb1ed9245cf9b170eff045a64c))
* **#981:** close round 3: a recovery's carried age, a late receipt's root, and held dispatch ([e6e80cc](https://github.com/prismalens/prismalens/commit/e6e80ccf3bed3546d78f9624879d4aaf5a540c5d))
* **#981:** close the code round's objections on recovery, containment and shutdown ([5bd4f82](https://github.com/prismalens/prismalens/commit/5bd4f82ac8b4c47b81908cc829b5fb8c6cd79f96))
* **#981:** shutdown asks answer cancelled, Resume keeps the no-receipt rule, POSIX kills only a proven group ([bc0b5d4](https://github.com/prismalens/prismalens/commit/bc0b5d429c03e2726f60dad0999018f3a6cd2596))
* **#983:** an invalid time zone is a recurrenceError, and the spring-gap note needs a slot at the change ([471aa67](https://github.com/prismalens/prismalens/commit/471aa673979a87988ca92da5731295dbf6da9b85))
* **#984:** a push for a run with no incident names the run and its schedule ([964bab8](https://github.com/prismalens/prismalens/commit/964bab8489f0c7edafb42ea328afc8c9b8fbde0f))
* **#984:** CodeRabbit round on scheduled checks ([f1c1b1d](https://github.com/prismalens/prismalens/commit/f1c1b1daae98912a8de895c181c56950474a7210))
* **#984:** rebase onto [#983](https://github.com/prismalens/prismalens/issues/983); OpenAPI regenerated, a run with no incident binds its worktree and answers an ask link ([64bb318](https://github.com/prismalens/prismalens/commit/64bb31840d85967f72982cea1f381e809172d2b2))
* **#984:** Schedules has one New schedule, and with no service the dialog sends you to Services ([000a4be](https://github.com/prismalens/prismalens/commit/000a4be591b5cc8ceea51f60c4975bb29bfa26af))
* **#984:** the scheduled-run page shows every hypothesis, with no dead Open larger and cites as text ([922cdcd](https://github.com/prismalens/prismalens/commit/922cdcd5444542b27a9992ebede63ebbe7f3e6fe))
* **#987:** a resumed run's duration leaves out the restart gap, and the phone strip reads Run N interrupted ([a716583](https://github.com/prismalens/prismalens/commit/a7165834c0ac85c76cbfbc58d0c3e271eeeb7fd9))
* **#987:** a run with no incident resumes on its own branch, and its gap reads unchecked ([7d7b792](https://github.com/prismalens/prismalens/commit/7d7b792d0de2cfda3b25c28bae5edbfee797fefe))
* **#987:** an interrupted run reads interrupted everywhere and resumes that same run ([a7987a2](https://github.com/prismalens/prismalens/commit/a7987a2a0311ddd1bda2063934e26d4f1d97dc02))
* **#987:** regenerate openapi.json for the resume and restart routes and the endReason fields ([b8ca25a](https://github.com/prismalens/prismalens/commit/b8ca25ada9ee9c4dd32bfe5d605f34f5192bd456))
* **#987:** the incidents payload carries endReason, and the overview names an interrupted run ([0e52646](https://github.com/prismalens/prismalens/commit/0e526466ef06a5df59e6e54b765272b96976d466))
* **#987:** the restart notice links a run with no incident to its run page ([#984](https://github.com/prismalens/prismalens/issues/984) makes incidentId nullable) ([6b6bfd9](https://github.com/prismalens/prismalens/commit/6b6bfd9c268cd7b7c0cbab7035dbf9748a337bbb))
* **#987:** the restart summary names a run with no incident as null, and OpenAPI regenerated on [#984](https://github.com/prismalens/prismalens/issues/984) ([3a4cfe8](https://github.com/prismalens/prismalens/commit/3a4cfe88574c03a1fd075be48250d1acd07f87a2))
* **agents:** a fatal launch error is never a sign-in, and the report treats artifact rows as data ([#1013](https://github.com/prismalens/prismalens/issues/1013)) ([a06db96](https://github.com/prismalens/prismalens/commit/a06db96de7137e156375fd730448767dfbdb65d0))
* **agents:** catch a fatal launch error as stderr arrives, before the 2 KB tail drops it ([#1013](https://github.com/prismalens/prismalens/issues/1013)) ([a1eb26f](https://github.com/prismalens/prismalens/commit/a1eb26f4604bd0433a724267e068a29396c62b54))
* **agents:** hand a Windows .cmd companion's .exe to the adapter, and give initialize 30 s ([#1013](https://github.com/prismalens/prismalens/issues/1013)) ([421d8cd](https://github.com/prismalens/prismalens/commit/421d8cd574de3fdc71244be3ce347f9ce7980f32))
* **agents:** OpenCode 2.x and slow-network Codex start, and the nightly probe launches agents as the product does ([#1013](https://github.com/prismalens/prismalens/issues/1013)) ([e461541](https://github.com/prismalens/prismalens/commit/e461541b3cd343052353912b188fd29bad34aac8))
* **agents:** OpenCode 2.x and slow-network Codex start, and the nightly probe launches agents as the product does ([#1013](https://github.com/prismalens/prismalens/issues/1013)) ([29b00b6](https://github.com/prismalens/prismalens/commit/29b00b64db417f564b6ed27e0fe73330db2fffca))
* **agents:** probe the shipped adapters and OpenCode 2, keep sign-in to keyless rows, and file issues from a job that runs no probe code ([#1013](https://github.com/prismalens/prismalens/issues/1013)) ([64466a3](https://github.com/prismalens/prismalens/commit/64466a340e71792ee2ad8dc43b02b2b75f712e16))
* **alerts:** remember a resolution that arrives before its firing, across restarts ([#1006](https://github.com/prismalens/prismalens/issues/1006)) ([9abd4ae](https://github.com/prismalens/prismalens/commit/9abd4ae3cbaafa58ef4592925104aa58dcd905f4))
* **api:** a proposal a stop left applying is settled at boot, and the user can dismiss it ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([ab7c7fc](https://github.com/prismalens/prismalens/commit/ab7c7fc61efb066f9be335edc5e40ddeb78570b2))
* **api:** a result whose reopen keeps throwing is given up after 30 tries ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([07c06c8](https://github.com/prismalens/prismalens/commit/07c06c88ac422038741ca60c367d756f83e5cc54))
* **api:** caps hold under concurrent act calls, and a start resumed after a crash finds its child ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([365201a](https://github.com/prismalens/prismalens/commit/365201a23516fc5a37e1709b5b88c507057c500c))
* **api:** claim a proposal before it applies; a reused role names its running holder; parked messages never block delivery ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([4c5cf7b](https://github.com/prismalens/prismalens/commit/4c5cf7be492f19b2cbf21a1ba4f4e052442d14dd))
* **api:** message delivery runs one pass at a time; a plain-folder parent is told up front it cannot start children ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([7f73823](https://github.com/prismalens/prismalens/commit/7f738234d31e664ca6e25ef653b9f99fe1a6cf05))
* **api:** one failing delivery never stops the rest of its pass ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([2fe658b](https://github.com/prismalens/prismalens/commit/2fe658b1287b079dc7252dd245ffba248c6a0858))
* **api:** outcome delivery runs one pass at a time, so no outcome is sent twice ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([fce2738](https://github.com/prismalens/prismalens/commit/fce2738e171ee17e611a98174ed82c8a69c32143))
* **api:** rows a delivery pass puts off never hold back newer ones ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([b8a5ca4](https://github.com/prismalens/prismalens/commit/b8a5ca4baff2b3a61ea53fc144d922c87140dca7))
* **api:** tree records go with their thread; outcomes and waits never stall; proposals refuse what cannot apply ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([3ebde3b](https://github.com/prismalens/prismalens/commit/3ebde3bdb1528ec09308f7c28c0feada55c5d5e3))
* **app:** /services?add=1 typed by hand opens Add, and a missing git says so ([e73ae2a](https://github.com/prismalens/prismalens/commit/e73ae2a1e1a4528c17e8a1b2867cf6ad93a300e0))
* **app:** an agent's wakes are budgeted, end on stop and settle, and watches back off ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([407532d](https://github.com/prismalens/prismalens/commit/407532d483d2a82e1070f5b377059ea87aadcd8b))
* **app:** contain the live diff and settle edge cases ([#1032](https://github.com/prismalens/prismalens/issues/1032)) ([14e0772](https://github.com/prismalens/prismalens/commit/14e07725faeb265d5484eb0c73f72798f093fb21))
* **app:** harden the live diff, thread list state and Search ([#1030](https://github.com/prismalens/prismalens/issues/1030)) ([c00e9a0](https://github.com/prismalens/prismalens/commit/c00e9a07d4004b0c294c0c5bbd86a32d26d6f033))
* **app:** PR-watch wakes count in the budget, a reopened thread keeps its wakes, and a host failure reaches the watch ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([75080c7](https://github.com/prismalens/prismalens/commit/75080c7fe531c2f98e442ec5c9f14cc800f7f69a))
* **app:** regenerate openapi.json, and let the endpoint smoke wait for the handoff's record ([48cc683](https://github.com/prismalens/prismalens/commit/48cc6837e788f05e8cc5f7fe7cfa61e909118c32))
* **app:** service mode only under the installed unit, and one install at a time ([#724](https://github.com/prismalens/prismalens/issues/724)) ([82c2f76](https://github.com/prismalens/prismalens/commit/82c2f7664397cefa5ea9506ffe99e416a033b8f0))
* **app:** the ask tools' descriptions follow the tool checklist ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([e058e5c](https://github.com/prismalens/prismalens/commit/e058e5c9535109e7b32aa81dc9259766d2fa3f64))
* **app:** the pre-merge review's minors for [#724](https://github.com/prismalens/prismalens/issues/724) and the git host listing ([098f50c](https://github.com/prismalens/prismalens/commit/098f50c909ce8a518c8be2a9b19bf48d3adac654))
* **app:** the wake and PR tools follow the tool checklist, and their walk uses the fake agent's own MCP calls ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([37f670f](https://github.com/prismalens/prismalens/commit/37f670fb85c23d5293dedadc60503b3533fc4d93))
* Back after Forward, split symlink patches, a stalled deployment lookup and huge repositories ([#973](https://github.com/prismalens/prismalens/issues/973)) ([1ca9eca](https://github.com/prismalens/prismalens/commit/1ca9ecaafafbb5cc9f02e263025f58697e1078fc))
* **ci:** start the deepagents probe with a placeholder model ([#1035](https://github.com/prismalens/prismalens/issues/1035)) ([#1045](https://github.com/prismalens/prismalens/issues/1045)) ([820bc1a](https://github.com/prismalens/prismalens/commit/820bc1accd9716183fae594a2387b73ba7e8250c))
* **composer:** decline a malformed required list, check date-time offsets, keep ..-named folders ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([522184b](https://github.com/prismalens/prismalens/commit/522184babe7d93dc63b636dacc532d3b04e63429))
* **composer:** only a lost race is a 409; bound the folder walk; file tools fit their subjects ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([c8fb1d8](https://github.com/prismalens/prismalens/commit/c8fb1d8b7869638aa44b8680500f84cef4ce09d3))
* **composer:** settle the 7bfb93a7 re-review and CodeRabbit's incremental findings ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([65ddf32](https://github.com/prismalens/prismalens/commit/65ddf329e655a9d6ad21edb747dd35a203b1c0d9))
* **composer:** settle the final check at 64a5816c ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([b265ed8](https://github.com/prismalens/prismalens/commit/b265ed890a4451d356243a4248c5469177f55423))
* **composer:** settle the pre-merge review and CodeRabbit findings ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([ef853e3](https://github.com/prismalens/prismalens/commit/ef853e319f5ff11b14e3e25932c03247566457a0))
* **contracts:** keep the ask answer schemas importable from investigation ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([ecfea94](https://github.com/prismalens/prismalens/commit/ecfea9424a9f0072fd80caaac8c5d4e181bbcecc))
* **database:** drop an empty migration the authoring run left behind ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([704c9ed](https://github.com/prismalens/prismalens/commit/704c9ed42fa2105a0f92a3650301ba48687a81f2))
* **database:** thread_tree keeps session_wake's investigation columns when it rebuilds the table ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([8b3e8c1](https://github.com/prismalens/prismalens/commit/8b3e8c10488c6b913c064776725d424d49a8f9ac))
* **database:** thread_tree keeps thread_context's agentPlan when it rebuilds investigations ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([bb7e927](https://github.com/prismalens/prismalens/commit/bb7e9273c67575d43a763791db467abee0657798))
* **desktop:** clearing the browser closes its view, whatever the page wants; the address follows the page unless the user is typing ([#973](https://github.com/prismalens/prismalens/issues/973)) ([01422a2](https://github.com/prismalens/prismalens/commit/01422a2faa0b241ad1b37838b87f5f9ca144a089))
* **desktop:** the browser's guards read a navigation strictly; popups are named, not followed ([#973](https://github.com/prismalens/prismalens/issues/973)) ([7ef880b](https://github.com/prismalens/prismalens/commit/7ef880b1b34ea821d79badf767e1b2b39009b557))
* **desktop:** the panel's browser raises no dialogs, opens no popups outside itself, presents no client certificate, and its tab keeps its page ([#973](https://github.com/prismalens/prismalens/issues/973)) ([bafb96c](https://github.com/prismalens/prismalens/commit/bafb96c03bd16861555b4b3650b6d3c5b73a18fe))
* **dispatch:** never kill a leaderless POSIX group on recovery ([7de832d](https://github.com/prismalens/prismalens/commit/7de832d3547ff6a7ff3ae3b4a210d753cb9e501a))
* **dispatch:** PrismaLens closing is not an operator Stop: a shutdown abort writes no end ([#981](https://github.com/prismalens/prismalens/issues/981)) ([410b173](https://github.com/prismalens/prismalens/commit/410b1734a133a35cf03a7cde7758ca3f02fdf69b))
* **e2e:** a local Playwright run exits when a test fails ([0dd8311](https://github.com/prismalens/prismalens/commit/0dd83119c44f930b7da8369456ed19785a9f9aea))
* **engine:** calls and findings acknowledged after a turn's last item are still recorded, once; the record row checks source and statement; the labelled search comparison repeats three times ([e45bf5f](https://github.com/prismalens/prismalens/commit/e45bf5f4fcafc2421435cd63478c19d34f002ecf))
* **frontend:** a ?panel= link opens the panel on its tab, the old run address keeps it, and closing drops it ([#975](https://github.com/prismalens/prismalens/issues/975)) ([70a16af](https://github.com/prismalens/prismalens/commit/70a16af6cedd09f629dc47db0a743459dd277a53))
* **frontend:** a closed bottom panel keeps its content mounted, hidden and inert; phone Back returns focus to its opener ([#974](https://github.com/prismalens/prismalens/issues/974)) ([9b8f10c](https://github.com/prismalens/prismalens/commit/9b8f10c88368bdfdf6b841b6c9516438aa53428c))
* **frontend:** a failed plain chat opens its run instead of retrying an investigation ([46938b0](https://github.com/prismalens/prismalens/commit/46938b0578bfca49bcbdf7e42e7af2adc339fbc6))
* **frontend:** a phone's sheet is the app's Radix dialog; the panel keeps its state and focus across breakpoints ([#973](https://github.com/prismalens/prismalens/issues/973)) ([3f49f74](https://github.com/prismalens/prismalens/commit/3f49f74b101c73ba0d4c2475b737b6e7dee71add))
* **frontend:** a phone's sheet opened for a file closes with it; journeys check every width reaches the panel's last line ([#973](https://github.com/prismalens/prismalens/issues/973)) ([ecf8294](https://github.com/prismalens/prismalens/commit/ecf829430fd8eeee437a962da389d2c7d8d6af7f))
* **frontend:** an old Settings tab link redirects on a page load ([#1020](https://github.com/prismalens/prismalens/issues/1020)) ([1757c3f](https://github.com/prismalens/prismalens/commit/1757c3f219aa4cbd5017215322c972ef70282422))
* **frontend:** Automation's schedules fit a phone, and the Slack deep link opens the incident itself ([#1020](https://github.com/prismalens/prismalens/issues/1020)) ([8f1ab22](https://github.com/prismalens/prismalens/commit/8f1ab22195bff6c662e2e091650e9f72ee776063))
* **frontend:** edges are hairlines, not borders, and the Threads filters use the app's Select ([#1020](https://github.com/prismalens/prismalens/issues/1020)) ([120b639](https://github.com/prismalens/prismalens/commit/120b63972ac3e37db79c883887aac1753fbea36e))
* **frontend:** Home's service picker shows its focus ring ([#1020](https://github.com/prismalens/prismalens/issues/1020)) ([22a5b37](https://github.com/prismalens/prismalens/commit/22a5b37aee1f4c54dca255401d409c26b07fc579))
* **frontend:** review fixes for the away strip, titles, automation page, services and sign-in gating ([a916766](https://github.com/prismalens/prismalens/commit/a9167667eae7bd894505710fe6199c884de0bbb0))
* **frontend:** review fixes for the shell, inbox model, day groups and titles ([8fdca66](https://github.com/prismalens/prismalens/commit/8fdca66a11c38bad143deb5ce025e8a9ea98f2db))
* **frontend:** Run details tabs fit at 320 px, Changes uses the app's Select, and the specs follow the Evidence tab moving to Summary ([#975](https://github.com/prismalens/prismalens/issues/975)) ([1057131](https://github.com/prismalens/prismalens/commit/10571319dc20e218b21068fd52067533dbfa331c))
* **frontend:** set the date before snapping to midnight so a skipped DST midnight stays in its day ([c6b5ff1](https://github.com/prismalens/prismalens/commit/c6b5ff1114a4cf3bc2b3108abadbd053899f713e))
* **frontend:** settled threads leave Recents, an old Settings tab link redirects on a cold load, and an empty Services list offers its helper ([#1020](https://github.com/prismalens/prismalens/issues/1020)) ([80e2510](https://github.com/prismalens/prismalens/commit/80e25102863fcc70f975090bbba518b88416efc3))
* **frontend:** terminal e2e reads the auggie command from the registry ([#1087](https://github.com/prismalens/prismalens/issues/1087)) ([c0025d9](https://github.com/prismalens/prismalens/commit/c0025d9009c773cea593874931f6022cad4b6669))
* **frontend:** the panel survives blocked storage and breakpoints, Escape reaches its content, a phone's sheet is modal ([#973](https://github.com/prismalens/prismalens/issues/973)) ([e785888](https://github.com/prismalens/prismalens/commit/e7858889e05f8e302575c5bff02a97b23125b137))
* **frontend:** the panel's six tabs fit its default width and the phone sheet ([#977](https://github.com/prismalens/prismalens/issues/977)) ([260d1a6](https://github.com/prismalens/prismalens/commit/260d1a637d81fd225e52a84ebe75a38bea17aa23))
* **frontend:** the sidebar sits at the top as the desktop title row, and logging an incident goes through Home ([#1020](https://github.com/prismalens/prismalens/issues/1020)) ([3892445](https://github.com/prismalens/prismalens/commit/38924456757adf26476d78dd008e008221f28125))
* **frontend:** the summary's edge is a hairline, not a border ([#1020](https://github.com/prismalens/prismalens/issues/1020)) ([d53d4ca](https://github.com/prismalens/prismalens/commit/d53d4ca15f3854f9eb460509b3d97f8cbd37ad69))
* **gateway:** adversary round 2 on [#970](https://github.com/prismalens/prismalens/issues/970) ([caf052b](https://github.com/prismalens/prismalens/commit/caf052bba8397f6481cbd648a6c47133e3b3a7ff))
* **gateway:** adversary round 3 on [#970](https://github.com/prismalens/prismalens/issues/970) ([4408504](https://github.com/prismalens/prismalens/commit/4408504f0a57b955663c45483f10cc8bc5ed73ce))
* **gateway:** adversary round 4 on [#970](https://github.com/prismalens/prismalens/issues/970) ([8fe9369](https://github.com/prismalens/prismalens/commit/8fe9369caf7bfaa6d8fb056aef9db38e97223bd1))
* **gateway:** fixes_list leaves out a fix whose run has no incident ([#970](https://github.com/prismalens/prismalens/issues/970), [#984](https://github.com/prismalens/prismalens/issues/984)) ([2e6f79d](https://github.com/prismalens/prismalens/commit/2e6f79dd238af532b2f039427ae364ae5e201db6))
* **gateway:** re-anchored evidence shows again, thread_list stays inside thread_read's scope, run_status counts a follow-up's own clock ([#970](https://github.com/prismalens/prismalens/issues/970)) ([df62670](https://github.com/prismalens/prismalens/commit/df626704e39d3a69d1a15a12c532ab22daafa254))
* **gateway:** thread_read refuses a thread whose run has no incident ([#970](https://github.com/prismalens/prismalens/issues/970), [#984](https://github.com/prismalens/prismalens/issues/984)) ([a197a71](https://github.com/prismalens/prismalens/commit/a197a719fa5b3e193052e895c71033800d9686cd))
* **investigations:** keep the operator's recorded cause apart from the agent's in the context pack ([cab0751](https://github.com/prismalens/prismalens/commit/cab0751cd6a9bec4f292c2ec00eb3b5cf9b0917a))
* leaving a run clears its page; typed host:port addresses open; report links end at their line ([#973](https://github.com/prismalens/prismalens/issues/973)) ([148dfb0](https://github.com/prismalens/prismalens/commit/148dfb09c9bee81ddab7afe46fa70d7e77c2dd46))
* **references:** discard a folder that resolves elsewhere after it was read ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([64a5816](https://github.com/prismalens/prismalens/commit/64a5816c090791ea279dbe234a2a8bf0cec98dfc))
* **run-workspaces:** open in editor refuses a link that leaves the workspace ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([2319cc5](https://github.com/prismalens/prismalens/commit/2319cc5bfcd533acc31ce67f191df6196cac82a6))
* **schedules:** both radios keep their size ([#979](https://github.com/prismalens/prismalens/issues/979)) ([19765d3](https://github.com/prismalens/prismalens/commit/19765d3bfa8b2f5b15e6906d46bb860fbaeeb285))
* **schedules:** Codex round 4 on the diff ([#979](https://github.com/prismalens/prismalens/issues/979)) ([fbc616c](https://github.com/prismalens/prismalens/commit/fbc616cf913b0d6c54f7efc7724320d575a4da0c))
* **schedules:** rows separate by tone, not borders; no DOM tooltips; OpenAPI spec regenerated ([#979](https://github.com/prismalens/prismalens/issues/979)) ([011b301](https://github.com/prismalens/prismalens/commit/011b3017c2a26bee0a5d621e4bf06f3797ac5efd))
* **schedules:** Run now twice in one second answers CONFLICT, not 500 ([#979](https://github.com/prismalens/prismalens/issues/979)) ([776d21b](https://github.com/prismalens/prismalens/commit/776d21b94a0ff6d9599f62fef198bef1c2adf504))
* **schedules:** the editor scrolls between a fixed header and footer; radios keep their size on a phone ([#979](https://github.com/prismalens/prismalens/issues/979)) ([1311f09](https://github.com/prismalens/prismalens/commit/1311f099a9e648dfd9ab708f80c0fe50290e727a))
* **session:** a wake is done only on delivery, and a re-queued resume never repeats its text ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([a46813d](https://github.com/prismalens/prismalens/commit/a46813ddcd59b33b1c383d6cdcfd58ff975736d8))
* **session:** a wake whose checkout is gone is dropped, not retried ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([814b070](https://github.com/prismalens/prismalens/commit/814b070b62dedce1b8101ec8099b9e83bbd55f6e))
* **session:** pass the session choice after [#1067](https://github.com/prismalens/prismalens/issues/1067)'s message context ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([d7ae4d1](https://github.com/prismalens/prismalens/commit/d7ae4d1a900bde6d765423bb567f3bbc7b7a9128))
* **session:** wakes are consumed with their admission, and a limit resume keeps what the user sent ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([725f856](https://github.com/prismalens/prismalens/commit/725f85600af12b3f271d1da95f66e0f6e7eb997b))
* the panel's tree, diff and history hold up under adversary review ([#973](https://github.com/prismalens/prismalens/issues/973)) ([7937dbd](https://github.com/prismalens/prismalens/commit/7937dbd1aaf349b7c8e58a05c86203afa7780077))
* **threads:** a watch backs off only when the host itself cannot answer ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([73246d1](https://github.com/prismalens/prismalens/commit/73246d104191e68a808ed63f52b0e34d6039e14d))
* **threads:** a watch outlives a failed handoff, a pass outlives a failed thread, and a failed stop keeps the agent's wakes ([#1024](https://github.com/prismalens/prismalens/issues/1024)) ([8f27452](https://github.com/prismalens/prismalens/commit/8f2745286fc9242a601132d113b16b82c4c9450c))
* **threads:** commit PR watch handoff with its wake ([1640526](https://github.com/prismalens/prismalens/commit/16405269e8d679d644971ac9e610ac01eaa421ea))
* **webhooks:** a generic webhook's serviceId or serviceName picks its service ([#1008](https://github.com/prismalens/prismalens/issues/1008)) ([#1047](https://github.com/prismalens/prismalens/issues/1047)) ([3b835c9](https://github.com/prismalens/prismalens/commit/3b835c9bc763106375a03ae04dee068b1c3baded))

## [0.5.3](https://github.com/prismalens/prismalens/compare/v0.5.2...v0.5.3) (2026-11-01)


### Features

* **#817:** PrismaLens's brief is appended to Claude's system prompt ([6759a17](https://github.com/prismalens/prismalens/commit/6759a1733e34e749d6d1cc5306a070097bf41264)), closes [#817](https://github.com/prismalens/prismalens/issues/817)
* **#848:** a run's detail says whether its pre-run snapshot was saved ([fa9472a](https://github.com/prismalens/prismalens/commit/fa9472a90bdcaf064f7a2a6e1a7ad14663781400))
* **#848:** a service's connections are tagged and switched in place ([cb1fbe9](https://github.com/prismalens/prismalens/commit/cb1fbe9545f89da23e9dea1615745c1fcb1cbde7))
* **#848:** a service's connections can be reordered ([916b555](https://github.com/prismalens/prismalens/commit/916b5558f856d9caf1c1cab657bb09c4fc9d908f))
* **#848:** a service's connections carry their priority ([173b1af](https://github.com/prismalens/prismalens/commit/173b1af21624eb372d3fb412be1a478a853ec2d1))
* **#848:** Add agent finds agents in the bundled ACP registry ([e47ff80](https://github.com/prismalens/prismalens/commit/e47ff80b1e1ae067e6dc50805bcbabba8c0241f5))
* **#848:** Alert intake and Notifications take their parts of the old pages ([30a867b](https://github.com/prismalens/prismalens/commit/30a867bc5ad71e6d4d0ddad32b6c45497c330410))
* **#848:** an API lists each git host's credentials ([37cf8c1](https://github.com/prismalens/prismalens/commit/37cf8c17ae7c5046747d38b4f99ccc8350133f6f))
* **#848:** Appearance, with the interface font ([6134a58](https://github.com/prismalens/prismalens/commit/6134a58353b77b6f89a65c004d518351360a31ea))
* **#848:** connections are picked by the incident's services, stored over env inside one ([6d46670](https://github.com/prismalens/prismalens/commit/6d46670e357ce60d6d26ff141efd3f245dcaa0fb))
* **#848:** each harness-tool call is a live event, with a summary per turn ([bbfb505](https://github.com/prismalens/prismalens/commit/bbfb50572ce09f57d3f30f0290310ecd60116886))
* **#848:** git uses the pin, the stored token, env, then your git ([5967b33](https://github.com/prismalens/prismalens/commit/5967b332bd294cac303fc0f73585d04128b32cb6))
* **#848:** incident_get serves deploy and change events ([5f2f051](https://github.com/prismalens/prismalens/commit/5f2f0516a7e9b59329735682d100cf3f077d149b))
* **#848:** pl doctor names environment fallbacks ([b3012d7](https://github.com/prismalens/prismalens/commit/b3012d7fcb905ce359c31e23c92113b2a7529c34))
* **#848:** PrismaLens fetches incident context before the run; the gateway carries only its own tools ([cc1ba71](https://github.com/prismalens/prismalens/commit/cc1ba71634fd5c3453e2735dcb35c23031153a81))
* **#848:** read API for a run's pre-run sources and a service's selection ([f8d781c](https://github.com/prismalens/prismalens/commit/f8d781cbafaa1e25b67ef2786a74a15690d92465))
* **#848:** settings pages in their new order, with a sidebar that hides completely ([c4fe553](https://github.com/prismalens/prismalens/commit/c4fe5533a360fe2c6c9cfbefcaa100c70a6170d3))
* **#848:** sources list, draft test and save, bundled ACP registry ([1226e36](https://github.com/prismalens/prismalens/commit/1226e36a2fe6d290688edfd917b4d54224655bc7))
* **#848:** Sources shows each source's credential and state ([ccf1fa0](https://github.com/prismalens/prismalens/commit/ccf1fa08ac35feeae0fd53d5d9cc451baf4c55bb))
* **#848:** telemetry reads the incident window with the mapping's selectors, within 256 KiB ([25f2a70](https://github.com/prismalens/prismalens/commit/25f2a70eadaf547b1fcbbd26fdf2488cc46c4d59))
* **#848:** the pre-run snapshot is stored with the run and copied safely ([1de88ba](https://github.com/prismalens/prismalens/commit/1de88ba2658a16020dc296b04cff68eb58554be7))
* **#848:** the report shows what was read before the run ([6ad2be3](https://github.com/prismalens/prismalens/commit/6ad2be396e04403efd9553bd1f732cf5c912fc9c))
* **#848:** the report tells found, empty, skipped and not read apart ([f716608](https://github.com/prismalens/prismalens/commit/f716608cb3b49233fff86f51a63ae100b12eee09))
* **#848:** the run lists the runbooks it found ([ce757db](https://github.com/prismalens/prismalens/commit/ce757db7cec3a73a55d008aea39c520e9aa7ba8c))
* **#848:** the run says whether PrismaLens's tools reached the model ([c954ef6](https://github.com/prismalens/prismalens/commit/c954ef6ab0e22f358c1874be9f08ee8305ff22b5))
* **#848:** the run shows an unsaved or unavailable snapshot ([d23dfad](https://github.com/prismalens/prismalens/commit/d23dfad56d8873c86c4dea68016703379fa7c629))
* **#855:** pull deploys through any registered adapter, not a GitHub host check ([09aaaa7](https://github.com/prismalens/prismalens/commit/09aaaa716005cc9ef3310209b21eeb5bfca8658b))
* **#914:** qualify five agents on aimock with one behaviour matrix ([6fa9852](https://github.com/prismalens/prismalens/commit/6fa9852d3fbdfde75641151c187a6eee36669455))
* **agent-adapters:** ship each ACP adapter as one esbuild ESM file, pinned by the lockfile ([#906](https://github.com/prismalens/prismalens/issues/906)) ([6a8647b](https://github.com/prismalens/prismalens/commit/6a8647b39bebbfc9f5b7af0269d91d026293c068))
* **agent-host:** 0.0.2 ports [#922](https://github.com/prismalens/prismalens/issues/922)'s run-worktree fixes, and the probe returns what a product shows ([3720417](https://github.com/prismalens/prismalens/commit/3720417350d413e8527374e30577903d6bc3d779))
* **agent-host:** a product's own secrets are dropped from every env layer, after overrides ([#817](https://github.com/prismalens/prismalens/issues/817)) ([179e70a](https://github.com/prismalens/prismalens/commit/179e70abc81c60522afd3a705afb0dcaea17fa3b))
* **agent-host:** one package for launching coding agents, shared by PrismaLens and Assayer ([5b06fff](https://github.com/prismalens/prismalens/commit/5b06fff33c46bb751acc4344eb00d5ab2fb43d12))
* **agent-host:** one package for launching coding agents, shared by PrismaLens and Assayer ([59c490b](https://github.com/prismalens/prismalens/commit/59c490b4d117889372c3059360f7c501e1b765ae))
* **agents:** binary path, config dir and a local agent reach launch, check and run record ([#907](https://github.com/prismalens/prismalens/issues/907)) ([68537a1](https://github.com/prismalens/prismalens/commit/68537a19c29dc5d45cb9996670cbff5ebafe192e))
* **agents:** Gemini levels map to its own modes now trust is the user's ([#907](https://github.com/prismalens/prismalens/issues/907)) ([f235fb4](https://github.com/prismalens/prismalens/commit/f235fb48dc82739533daac18466428e2211d0a59))
* **api:** agent runtime settings, write-only env store, host-only writes and runnable ([#907](https://github.com/prismalens/prismalens/issues/907)) ([cad3f93](https://github.com/prismalens/prismalens/commit/cad3f937327dc78586e8119421f9b1c7a840ad72))
* **app:** run usage, evidence at its revision, never a dead end, hypothesis tree ([18f5559](https://github.com/prismalens/prismalens/commit/18f555916d16198430e5d44f170e5b158bc6b906))
* **app:** run usage, the Worked fold, evidence files at their revision and the hypotheses card ([e4205a0](https://github.com/prismalens/prismalens/commit/e4205a0adb840bc37fd8fdc024c1df9f684556c4))
* **ci:** the scripted model serves the Responses API and the admission gains a codex leg ([#914](https://github.com/prismalens/prismalens/issues/914)) ([c46d988](https://github.com/prismalens/prismalens/commit/c46d988f4f31e1e06c59f4e5dd18a57be45208f5))
* **doctor:** check only PrismaLens's own setup, never a coding agent ([d3dad53](https://github.com/prismalens/prismalens/commit/d3dad53bced634e1578d442a9e2bf1c3f239bc51))
* **doctor:** pl doctor names runnable agents only, and warns once when none can run ([#907](https://github.com/prismalens/prismalens/issues/907)) ([cab57b7](https://github.com/prismalens/prismalens/commit/cab57b7d9277481cc46e71f211e48239d3c44362))
* **engine:** record ACP sessions and replay them strictly through the real engine ([#914](https://github.com/prismalens/prismalens/issues/914)) ([337afa9](https://github.com/prismalens/prismalens/commit/337afa9ef337034fb386b03bf7e95b62bcbb40e1))
* **intake:** deploy events from any stack, vendor alert intake, on-call from a phone ([88035df](https://github.com/prismalens/prismalens/commit/88035df56c984c449b2ae2b3a59975f6306bd071))
* **picker:** one Default row, hidden models left out, operator order, only runnable agents on the rail ([#902](https://github.com/prismalens/prismalens/issues/902) f10, [#907](https://github.com/prismalens/prismalens/issues/907)) ([d69e70b](https://github.com/prismalens/prismalens/commit/d69e70b716e15154973f8204531eb79530243e97))
* **release:** standalone archives use the app/ layout, pruned, with a licence and path gate per artifact ([#906](https://github.com/prismalens/prismalens/issues/906)) ([a0bb050](https://github.com/prismalens/prismalens/commit/a0bb050c7e7bd9f1fa249e3e5e2589868fce2823))
* **run-workspaces:** keep until resolved by default, no cap, interrupted runs keep their workspace ([#925](https://github.com/prismalens/prismalens/issues/925), [#981](https://github.com/prismalens/prismalens/issues/981)) ([b3f1f5e](https://github.com/prismalens/prismalens/commit/b3f1f5e92e8dfd6b6b17bad1805d746e93d04537))
* **run:** continue a finished run in another agent, with the existing chips ([18b3598](https://github.com/prismalens/prismalens/commit/18b3598a5cb6f8755f969f2d794f2ef5027e9709))
* **runs:** [#848](https://github.com/prismalens/prismalens/issues/848) follow-up A: git credentials in order, pl doctor, the tool-call proof, and the API the new screens read ([f4606de](https://github.com/prismalens/prismalens/commit/f4606de6fa13e12fb0adeeedba966d2aefbb0f17))
* **runs:** a git URL is cloned once; each run gets a worktree of that copy ([#925](https://github.com/prismalens/prismalens/issues/925)) ([13f8757](https://github.com/prismalens/prismalens/commit/13f8757916a1d1ff4d51fb6d538197ff39fb01ff))
* **runs:** a local run works in a worktree of the user's repo ([#918](https://github.com/prismalens/prismalens/issues/918)) ([dd84805](https://github.com/prismalens/prismalens/commit/dd84805196c244ff3a86f1736978fb1e2433afaa))
* **runs:** a local run works in a worktree of the user's repo, so the agent's own trust applies ([#918](https://github.com/prismalens/prismalens/issues/918)) ([b9949dc](https://github.com/prismalens/prismalens/commit/b9949dc9f75d6fec820fd001f6bbe32ff50c81aa))
* **runs:** PrismaLens fetches incident context before the run, and its own tools reach every agent ([00971b7](https://github.com/prismalens/prismalens/commit/00971b78769ff706932c3b32682ad879c008be41))
* **runs:** PrismaLens launches agents through @prismalens/agent-host, with the user's environment minus its own secrets ([51d2308](https://github.com/prismalens/prismalens/commit/51d230830fc9885fd1363d58a6f37ca8d59ab5fb))
* **runs:** PrismaLens launches agents through @prismalens/agent-host, with the user's environment minus its own secrets ([8c9eab2](https://github.com/prismalens/prismalens/commit/8c9eab23e7b9302b148c93db368d678dff067d22))
* **runs:** run workspaces are the user's to configure: where, how, and what happens after ([#925](https://github.com/prismalens/prismalens/issues/925)) ([0bd194e](https://github.com/prismalens/prismalens/commit/0bd194e5c91794d16081b90342957dbbd8570667))
* **runs:** run workspaces follow the user's settings, global and per service ([#925](https://github.com/prismalens/prismalens/issues/925)) ([b2e1c51](https://github.com/prismalens/prismalens/commit/b2e1c51f50d7ee1dea4b263b445d14166cb12934))
* **runs:** Settings chooses where a git URL is cloned once ([#925](https://github.com/prismalens/prismalens/issues/925)) ([9ca0802](https://github.com/prismalens/prismalens/commit/9ca08024cc77aa7165dbbaadc017fc6528a0ee6b))
* **settings:** Add agent sets an agent up in three steps, Agent, Sign-in and Config ([#907](https://github.com/prismalens/prismalens/issues/907)) ([21cab5b](https://github.com/prismalens/prismalens/commit/21cab5bdf32cbb5084527a5288189ecc06d70810))
* **settings:** Agent takes [#935](https://github.com/prismalens/prismalens/issues/935)'s shared parts; registry search moves into Add agent ([29bb5ad](https://github.com/prismalens/prismalens/commit/29bb5ad0246eec55bbcca282f1fad8917cb81bb3))
* **settings:** agents that can run are listed, Add agent sets one up, models and levels by their real names ([71493ca](https://github.com/prismalens/prismalens/commit/71493cafde4ecea192c2622be4399e570442351d))
* **settings:** no Default label; real model and level names; env value states ([#907](https://github.com/prismalens/prismalens/issues/907)) ([6033ce4](https://github.com/prismalens/prismalens/commit/6033ce4f565ccbde83ac42939ea04611519833f8))
* **settings:** Settings → Agent lists runnable agents; each opens Models, Runtime and Environment ([#907](https://github.com/prismalens/prismalens/issues/907)) ([d4f540e](https://github.com/prismalens/prismalens/commit/d4f540e62775f29e06b1987b5215a3e1715c7b47))
* **ui:** [#848](https://github.com/prismalens/prismalens/issues/848) follow-up B: Sources, Alert intake, Notifications, coverage and the run's tool status, as signed off ([97176df](https://github.com/prismalens/prismalens/commit/97176df019bcdc76bb8a78fb82791e898c1d29d1))


### Bug Fixes

* **#79:** keep the vendor alert fixtures out of the published tarball ([a682ed3](https://github.com/prismalens/prismalens/commit/a682ed335f6edaf6046284c3a51e9b7731f3bb62))
* **#848:** 48 px boxes for Button triggers and a phone incident header that fits ([77d3754](https://github.com/prismalens/prismalens/commit/77d3754a8fd1fee65e4f6241c1bfe273112c7a21))
* **#848:** a coverage Fix opens the source that was skipped ([10d7901](https://github.com/prismalens/prismalens/commit/10d790116219e66c63714b6cd61237c8686d32e8))
* **#848:** a git helper never leaves as text, default ports match, the original token error is asserted ([ab2c25f](https://github.com/prismalens/prismalens/commit/ab2c25f4a7c237a5f051eac79e9d7934161c5939))
* **#848:** a refused token's own error survives a failed fall-through ([aa5e573](https://github.com/prismalens/prismalens/commit/aa5e57315db04e2bb0def2b2f0df22934751ae86))
* **#848:** a source address refuses user:pass@ and every response redacts it ([1f51e3e](https://github.com/prismalens/prismalens/commit/1f51e3ebc4d0b9b0b89080f14021d85b1bbeaa00))
* **#848:** a tool call's own arguments never make it a PrismaLens tool ([f0d2976](https://github.com/prismalens/prismalens/commit/f0d29768224eb2fb0b8254b0c4af73e3a2bada7d))
* **#848:** ACP registry install text must be copy-safe or the entry is dropped ([166d325](https://github.com/prismalens/prismalens/commit/166d325d6ab74ebb82d4743da0b3cbd6c82fcf8d))
* **#848:** Alert intake's Edit warns when the environment token stops applying ([716c993](https://github.com/prismalens/prismalens/commit/716c993f1d2dac25cc8c2b9152e0bc0e38a3b1b7))
* **#848:** close four credential disclosure paths (OBJ-036 to OBJ-039) ([eaab319](https://github.com/prismalens/prismalens/commit/eaab3197b195a276bf5336c941b8725ef2791f5c))
* **#848:** connections store an error code, never text, and addresses come back without credentials ([6dfe4c8](https://github.com/prismalens/prismalens/commit/6dfe4c877994f730edf7d3b8c4314cc365c20c8d))
* **#848:** credential origin proofs, containment test, and the pre-run-context flake ([be73198](https://github.com/prismalens/prismalens/commit/be73198260ec848aac9aa4dd493b4a7b1c9f5920))
* **#848:** credential origin proofs, containment test, and the pre-run-context flake ([289d2d1](https://github.com/prismalens/prismalens/commit/289d2d16745d003454ee2ca9469d892828fc325d)), closes [#848](https://github.com/prismalens/prismalens/issues/848)
* **#848:** every Button gets a real 48 px box on touch, not an overlay ([e690487](https://github.com/prismalens/prismalens/commit/e6904878cfbcedf24f6fb5fe368cd8c9e4dbbfea))
* **#848:** every Button, asChild anchors included, gets the 48 px touch hit area ([cbd9ef6](https://github.com/prismalens/prismalens/commit/cbd9ef64ea42a95c76064812b03d509eb47a4aaf))
* **#848:** every mapping change refreshes the deployment matrix ([c821f82](https://github.com/prismalens/prismalens/commit/c821f826f6be01b468cf7ff966ced463b25ee5c2))
* **#848:** every pre-run part has a deadline; a failed checkout never fails the run ([9eb50d6](https://github.com/prismalens/prismalens/commit/9eb50d6a898017859b1ff307d92a641fe6f72419))
* **#848:** Fix and its chevron keep separate 48 px hit areas on touch ([c782d9c](https://github.com/prismalens/prismalens/commit/c782d9c7cd21a9b2a1060211f6fa95d01643aeec))
* **#848:** Gemini runs force no folder trust ([b44abb0](https://github.com/prismalens/prismalens/commit/b44abb00ec60e57603ef155c1f56e8f4b49bbfbd))
* **#848:** git failures carry fixed text, and scp paths may contain # ([446056a](https://github.com/prismalens/prismalens/commit/446056a7e61c68f4987e7b375c536ec7ae44f317))
* **#848:** integrations and git tokens return only error text PrismaLens wrote ([869fdcf](https://github.com/prismalens/prismalens/commit/869fdcfe0bb138c1863cc60d713670295fdc912f))
* **#848:** keep the gateway bearer out of the transcript; log a failed lease ([3386540](https://github.com/prismalens/prismalens/commit/3386540916cdeb1b29c7dbda764bee873f7ee805))
* **#848:** keep the phone incident title a 48 px target down to 320 px (OBJ-012) ([b46dce8](https://github.com/prismalens/prismalens/commit/b46dce806769dd427f3a5428a60967fc5c08abfb))
* **#848:** many runbooks get search, service filters and repository groups ([1d745bd](https://github.com/prismalens/prismalens/commit/1d745bd1be4a94e4770267f6cd0cd6bf66aabc32))
* **#848:** pre-run logs and the save error keep driver messages out; guard the secondary sub-path ([4e8f39a](https://github.com/prismalens/prismalens/commit/4e8f39a53432ed44a867eee2f8c700649933b3e5))
* **#848:** review findings on cancellation, testedAt, scrub order and test timeouts ([54848cb](https://github.com/prismalens/prismalens/commit/54848cb6118646217e03ff393b7dcda2e61bd957))
* **#848:** review round 1 on the pre-run snapshot, tools and git ([cf1022c](https://github.com/prismalens/prismalens/commit/cf1022c8d5a10f55df5b989847d50efe9a331379))
* **#848:** review round 2 on containment, scrubbing and the byte bound ([cb6f600](https://github.com/prismalens/prismalens/commit/cb6f6003c2090cbe963870450996d6ec7d03633e))
* **#848:** review round 3: scrub before truncating, check the cwd after creating it ([16349c9](https://github.com/prismalens/prismalens/commit/16349c9076b230ea7a114ef5fb6a602d48e55d4e))
* **#848:** review round 4: never create directories inside a checkout ([b9a6706](https://github.com/prismalens/prismalens/commit/b9a670637e9ba5070dd937d6ac32610c72e795d6))
* **#848:** runbook filters start afresh per run; a service named all filters on its own ([b7bbe70](https://github.com/prismalens/prismalens/commit/b7bbe70ceac579ea5301f46f65d2851e16f02954))
* **#848:** scp remotes refuse a query, and git errors carry no stderr ([10fc646](https://github.com/prismalens/prismalens/commit/10fc646c4f3fc613bf59fb0a17b52710540db8e2))
* **#848:** source-history navigation keeps an open edit draft ([53f165b](https://github.com/prismalens/prismalens/commit/53f165b725faa933c7de9a13e13bfea66c982d46))
* **#848:** Sources follows a source reached through history ([a2afdeb](https://github.com/prismalens/prismalens/commit/a2afdeb3655a50032988e1566d4e0d5dfb961257))
* **#848:** Sources redacts addresses by parsing them, and message text token by token ([48bcd90](https://github.com/prismalens/prismalens/commit/48bcd90848598c65c2c7ffff9eee80c069dfb348))
* **#848:** Sources refuses a query or fragment in the address and redacts userinfo, query and fragment on every response ([3063cbe](https://github.com/prismalens/prismalens/commit/3063cbef3d07643e7bad95e7fb0d245a9a23904c))
* **#848:** Sources writes its own error text and never echoes an upstream message ([6ea6751](https://github.com/prismalens/prismalens/commit/6ea6751631ac700f5e83f26f5a8bbd65d1bd1313))
* **#848:** switches and icon buttons take a 48 px tap on touch ([e6a7d47](https://github.com/prismalens/prismalens/commit/e6a7d4756100bd96bfd1a122bd1c7262748b8930))
* **#848:** TelemetrySnapshotService keeps its DI metadata ([5ac7b18](https://github.com/prismalens/prismalens/commit/5ac7b186a4746056b3564d85278e3fc651a5b310))
* **#848:** test that a created alert keeps no userinfo in its source link ([e50723e](https://github.com/prismalens/prismalens/commit/e50723e480c18a694d4c5e156ef17703cbc18ced))
* **#848:** the many-runbooks test passes biome ([e53dd45](https://github.com/prismalens/prismalens/commit/e53dd451728884d52eda9157f16958f579f2cf8c))
* **#848:** the phone toolbar guard requires each control, at 320, 360 and 390 px (OBJ-013) ([82838fe](https://github.com/prismalens/prismalens/commit/82838fe5deb9179407cce107ad53d3301adc40a4))
* **#848:** the save-secret log assertion expands Error message and stack ([ef81848](https://github.com/prismalens/prismalens/commit/ef81848f45a564455db9779be808fd8b353993be))
* **#848:** the tools server takes a random name kept on the run ([9494159](https://github.com/prismalens/prismalens/commit/9494159c86d90a26278488f576e82af2316ed73c))
* **#848:** the Why card shows only the reported run's coverage ([157bff3](https://github.com/prismalens/prismalens/commit/157bff3efbca829263b843b4981ad370604ee114))
* **#854:** keep a rejected connection lookup inside pullDeploys, skip a legacy discovery link for the pinned token ([a56379e](https://github.com/prismalens/prismalens/commit/a56379e80ead463bbc3a903f7f2024f2bc482a20))
* **#854:** pull deployments with a pinned GitHub API token when no discovery link exists ([3ed3ffd](https://github.com/prismalens/prismalens/commit/3ed3ffdb63a732963653284f733c85ed96ef74ba))
* **#855:** pick the deploy adapter by repository host and take the credential from git's resolver ([4bacdca](https://github.com/prismalens/prismalens/commit/4bacdcae97f5250c32e1764435e9600185af67cf))
* **#855:** send the deploy pull's token to the host's REST API as Bearer ([008e62a](https://github.com/prismalens/prismalens/commit/008e62a6462b8016b83613ad4f2136f66a4da68c))
* **#872:** recheck waits on live runs and settings, hypotheses clip watches a stable wrapper, small costs stay nonzero ([c04f026](https://github.com/prismalens/prismalens/commit/c04f0260a001c2902910cb06b6a3d3e3e05acd5a))
* **#877:** fence and sanitize the handoff body and transcript, write each call once, write the transcript past symlinks, name the lock reason on the locked chip ([01304b2](https://github.com/prismalens/prismalens/commit/01304b2989cd079b047a17c367e3ba147a9ef5dd))
* **#885:** matrix runs go at once only on Linux, and each OpenCode run has its own cache and state ([4e18554](https://github.com/prismalens/prismalens/commit/4e185544df31b7fd4ce56fc8f42ff7f79b03bc9f))
* **#885:** the cancel row finds and stops only its own workspace's tool process ([35092af](https://github.com/prismalens/prismalens/commit/35092af8bb5a17c3ed32d2cd4de148271e1460ce))
* **#885:** the cancel row waits for the tool's own node process, not the shell wrapping it ([689ba08](https://github.com/prismalens/prismalens/commit/689ba089ad92f222b14b5717193ab16fd3579688))
* **#896:** useShared caches its input after commit, a run that ends with its stream down is caught up, the render probe is picked once at load ([411f025](https://github.com/prismalens/prismalens/commit/411f0250f88f8f5f7c2be3c472cdf1aea418d048))
* **#906:** review findings on [#913](https://github.com/prismalens/prismalens/issues/913) ([092364e](https://github.com/prismalens/prismalens/commit/092364ed73bc7fcb7572e33284dc907a035f9181))
* **#906:** second review round on [#913](https://github.com/prismalens/prismalens/issues/913) ([5e894a1](https://github.com/prismalens/prismalens/commit/5e894a19f2057c8f56bf850f7f3d1a00d618f042))
* **#914:** adapter pins live in devDependencies since [#913](https://github.com/prismalens/prismalens/issues/913) ([b0f28bc](https://github.com/prismalens/prismalens/commit/b0f28bc953c5be8b734c75a93c24f30c94b10067))
* **#914:** ask Codex to escalate in the permission rows ([7b68402](https://github.com/prismalens/prismalens/commit/7b68402a07b32753c2fd1638767d0ca01f248421))
* **#914:** codex tested records its companion codex pin, like claude-code ([3da15b0](https://github.com/prismalens/prismalens/commit/3da15b002edc7e4d68a3e1cb971f9431de2045bd))
* **#914:** match the incident result by tool, keep matrix workspaces out of /tmp ([87feb05](https://github.com/prismalens/prismalens/commit/87feb052b0775f6c997ebc557403496618e376f9))
* **#914:** the codex row says which codex the real-model runs used and which one CI pins ([564f195](https://github.com/prismalens/prismalens/commit/564f1952d2492ae134755ecc98b2e0d7f7ed3209))
* **#916:** agent-tested finds the rows in PRODUCT now that the registry is built from agent-host ([4284dcc](https://github.com/prismalens/prismalens/commit/4284dccd2f01259143c10f20e4b0314014e3595a))
* **#916:** review fixes - gateway check scoped to rows that read it, OpenCode inline deny order, symlinked worktree parent, resolved shim path ([ae4438a](https://github.com/prismalens/prismalens/commit/ae4438a44bc3605c0c3b5ff3f340533cb1227fa6))
* **#920, #914:** review findings on the upgrade loops, recorder, probe and side checks ([08f09eb](https://github.com/prismalens/prismalens/commit/08f09eb71cf3050e0ebee8a6d59efbde663b5bbe))
* **#925:** the service Workspace rows use the shared Row; the lifecycle spec expects the worktree path ([554d144](https://github.com/prismalens/prismalens/commit/554d14448168edbc77c6361a16002fe849755373))
* **#938:** encoded nested credentials, spaced userinfo, long-line stderr edges, unrelated failures under an expired token ([da6a16f](https://github.com/prismalens/prismalens/commit/da6a16f216ec8fb7977a6bd421b5a7ebc42e6f4d))
* **#938:** every outward read of a stored address is redacted; adversary round 1 ([a6f7b5c](https://github.com/prismalens/prismalens/commit/a6f7b5cbd726682a39d7a0c04e6b9b84cc2ce82c))
* **#938:** legacy names and pre-fix notes never show a credential; adversary round 2 ([b04d5a3](https://github.com/prismalens/prismalens/commit/b04d5a350933efaa9390c5336d153faf18fe4e7d))
* **#938:** legacy repository addresses never return a credential; stderr classified from its end; [#950](https://github.com/prismalens/prismalens/issues/950) expired-token fall-through ([1f56c17](https://github.com/prismalens/prismalens/commit/1f56c17bfb4e03a331e5e77c023b93d682ef4db6))
* **#938:** legacy repository addresses never show a credential; stderr scanned head and tail ([53f9bdb](https://github.com/prismalens/prismalens/commit/53f9bdba9ac3b4cb83ff3761196cf6c8ecb747ce))
* **#938:** notes scanned word by word, names of nested addresses withheld; adversary round 3 ([6804514](https://github.com/prismalens/prismalens/commit/680451481f03d3f7e12556c95064d344f29747be))
* **#938:** revert scp # stripping, # is a path character in scp addresses ([f8f37ea](https://github.com/prismalens/prismalens/commit/f8f37ea7ab13cf8bb6f60a58fb08a59d1e5a03ec))
* **#938:** scp addresses drop a # fragment as well as a query ([dab6b63](https://github.com/prismalens/prismalens/commit/dab6b6365711b6e0148401fba2799501f48b6956))
* **#938:** the repository-not-found pattern stops at the quote, so a capped tail classifies in linear time ([ae6a05a](https://github.com/prismalens/prismalens/commit/ae6a05a78580dd49cb98d8d5a70da7611b080c12))
* **#950:** an expired token passed over still names the fix when the fallback fails ([383d357](https://github.com/prismalens/prismalens/commit/383d357d74667ef004199a878aaea29d26a2c3bc))
* **#965:** pl upgrade on Windows drops PSModulePath, so it works from a PowerShell 7 terminal ([a9bab64](https://github.com/prismalens/prismalens/commit/a9bab64ef64209aba9c37b3aaddee1011b0c2e69))
* **agent-adapters:** 0.0.2 with a Node 22 floor; bundles target node22 ([b9fc6fe](https://github.com/prismalens/prismalens/commit/b9fc6fef861e08cf512db2f10740b906772fb476))
* **agent-host:** a kept, changed workspace never re-runs its teardown; Node &gt;=22.9.0 for which@6 ([d2b15a2](https://github.com/prismalens/prismalens/commit/d2b15a23f0e47fb141b9fc3c92dc9d4021001885))
* **agent-host:** close-based probe exit, real-path copy-in guard, abortable setup hook ([db0df08](https://github.com/prismalens/prismalens/commit/db0df0828e931b949dede5a16079181cb7fe491c))
* **agent-host:** on Windows a later env layer replaces a name spelled in another case ([#817](https://github.com/prismalens/prismalens/issues/817)) ([b7d4866](https://github.com/prismalens/prismalens/commit/b7d4866c6f13336bee57d187081aab2b94846c18))
* **agent-host:** OpenCode's run config goes inline, so the user's OPENCODE_CONFIG_DIR stays theirs ([#817](https://github.com/prismalens/prismalens/issues/817)) ([9b98437](https://github.com/prismalens/prismalens/commit/9b984378da1c1f093cdccb89c09550883693eb4d))
* **agent-host:** own secrets are refused by name in strict mode, in any case, and on the version probe ([#817](https://github.com/prismalens/prismalens/issues/817)) ([b33a71f](https://github.com/prismalens/prismalens/commit/b33a71fe8db6609f9508563ec568f6076ec92145))
* **agent-host:** port [#848](https://github.com/prismalens/prismalens/issues/848) and [#817](https://github.com/prismalens/prismalens/issues/817) launch facts from harness.ts ([faa8c01](https://github.com/prismalens/prismalens/commit/faa8c01ee93c80112e6c85f80fb98a303390b4e4))
* **agents:** HarnessModule imports ConfigModule for CredentialsService; regenerate openapi.json; tiles are toggle buttons ([#907](https://github.com/prismalens/prismalens/issues/907)) ([0597845](https://github.com/prismalens/prismalens/commit/05978453e65422d4d5ff3e1091c5c2997eb2dfdb))
* **api:** an agent-settings PATCH stores its variables and the rest in one transaction ([e79e35b](https://github.com/prismalens/prismalens/commit/e79e35b00ab8c0d7c522f403292e80df95fc3214))
* **changes:** [#854](https://github.com/prismalens/prismalens/issues/854) a deploy deleted since the list no longer drops the sync ([85d7e7e](https://github.com/prismalens/prismalens/commit/85d7e7ed6cb6612e8140425ab4e84888379cf00d))
* **changes:** [#854](https://github.com/prismalens/prismalens/issues/854) page GitHub Deployments back to the incident window ([6525e07](https://github.com/prismalens/prismalens/commit/6525e074bc1ec80158f44ed3b50bca6c30a72e75))
* **cli:** pl doctor enforces a patched Node release per line ([#998](https://github.com/prismalens/prismalens/issues/998)) ([811c722](https://github.com/prismalens/prismalens/commit/811c722c14525981b9220c82732f5539410bd7cb))
* **cli:** pl doctor refuses a Node below its line's patched release ([#998](https://github.com/prismalens/prismalens/issues/998)) ([b580174](https://github.com/prismalens/prismalens/commit/b580174f6c312bd0de7781fef2a60251755b549e))
* **config:** drop opencode --pure so a run keeps the user's plugins ([#817](https://github.com/prismalens/prismalens/issues/817)) ([488007a](https://github.com/prismalens/prismalens/commit/488007abd8a94127943f1f7586b88de177b2bc13))
* **doctor:** keep exit 1 when no agent on PATH can run ([a718615](https://github.com/prismalens/prismalens/commit/a718615621f42a0e90699c588879ea05a0078cb1))
* **frontend:** a chat's details explain a tools warning the phone strip hides ([4bc7882](https://github.com/prismalens/prismalens/commit/4bc7882c3f4c6c2b61df155fa3df229ed39e44fc))
* **frontend:** label-in-name for the sidebar Incidents link and the agent lettermarks ([3c4fdcf](https://github.com/prismalens/prismalens/commit/3c4fdcf7111ce4f346f63d895d9ec5a5c3c1573a))
* **frontend:** phone incident pages fit at 320-390 px, and phone Run details is a sheet ([882780b](https://github.com/prismalens/prismalens/commit/882780b2001c5780adf070001ac267027b876908))
* **frontend:** phone incident pages fit the screen and Run details is a sheet ([cec168f](https://github.com/prismalens/prismalens/commit/cec168f62cee13d9d534bb8fbf8822227f1e825a))
* **frontend:** phone Run details is a Radix sheet that keeps its place ([d14b862](https://github.com/prismalens/prismalens/commit/d14b862898f022b1b8c626d3359fe0b5522df479))
* **frontend:** the drawing returns focus to the sheet link, and the toggle shows a flag and a warning together ([fc49082](https://github.com/prismalens/prismalens/commit/fc4908207eda4b9c61cadcf91ba1ab7d0059baa6))
* **frontend:** the guard sees through a modal's scroll lock, and the drawing keeps the sheet's place ([8b29048](https://github.com/prismalens/prismalens/commit/8b290483a928988532a140d07c812ea4a8af8a12))
* **frontend:** the phone evidence sheet portals to the body, so the topbar no longer covers its Back ([0fc2335](https://github.com/prismalens/prismalens/commit/0fc2335ff01b574b9a4266337d42c6367c13eb04))
* **install:** install.ps1 is pure ASCII, so Windows PowerShell 5.1 parses it under -File ([#906](https://github.com/prismalens/prismalens/issues/906)) ([36e4a11](https://github.com/prismalens/prismalens/commit/36e4a11b699c247dc3c18229a1efa73e9d852c50))
* **pack:** agent-host is bundled like the other first-party packages, its deps in the union ([#916](https://github.com/prismalens/prismalens/issues/916)) ([6cd3196](https://github.com/prismalens/prismalens/commit/6cd3196a6292c02526ced1a98a0f48d1ed12f07a))
* **pack:** the import scan leaves a nested package to its own install, and agent-host carries no source maps ([#916](https://github.com/prismalens/prismalens/issues/916)) ([ecc547c](https://github.com/prismalens/prismalens/commit/ecc547ce4ce40ab1d3bd82575928a28563c1a5ad))
* **release:** every artifact is built and packed to a stated standard, within the Windows path limit ([668df78](https://github.com/prismalens/prismalens/commit/668df78dc38ab3fee4d753f5791207f1ffc2a79c))
* **run-workspaces:** boot sweep spares a pending follow-up's workspace; Remove shows a refusal ([#925](https://github.com/prismalens/prismalens/issues/925)) ([c78b918](https://github.com/prismalens/prismalens/commit/c78b91851a1ea7271c511c3615b6aacedc5f123b))
* **run-workspaces:** sweep never deletes copies in a current folder nested inside an old one ([#925](https://github.com/prismalens/prismalens/issues/925)) ([09d1838](https://github.com/prismalens/prismalens/commit/09d18384b15767a435a70d13d2c960359a726a3c))
* **run:** an ended run's last history read retries until it lands ([65a1c44](https://github.com/prismalens/prismalens/commit/65a1c446c8f9e66cf3bc51710341c1b121fc071b))
* **runs:** a checkout that finishes after the budget is released, not left locked ([#918](https://github.com/prismalens/prismalens/issues/918)) ([0a8563e](https://github.com/prismalens/prismalens/commit/0a8563e30a594c310414437ecc2539630d404f4b))
* **runs:** a late release never removes a worktree a later attempt re-added ([#918](https://github.com/prismalens/prismalens/issues/918)) ([8d14883](https://github.com/prismalens/prismalens/commit/8d14883780f5e07c689eeab7bb7eb3ea208bed2d))
* **runs:** a run loads the repo's own agent config; nothing is stripped ([#817](https://github.com/prismalens/prismalens/issues/817)) ([08aba0c](https://github.com/prismalens/prismalens/commit/08aba0c9670f618f890a6bcfaab8ff139364f846))
* **runs:** cleanup leaves a worktree someone else added in a run's folder, and an aborted setup's output reaches the run log ([#925](https://github.com/prismalens/prismalens/issues/925)) ([a8908d2](https://github.com/prismalens/prismalens/commit/a8908d256b46ec7c83753ad693da0fcfdeab8f11))
* **runs:** Codex pass on run workspaces: a pl-* repo folder keeps its run's liveness, the engine re-checks liveness before removing, a legacy run folder honours retention, only mirrors PrismaLens synced are swept, chat runs show kept workspaces ([#925](https://github.com/prismalens/prismalens/issues/925)) ([f0a0430](https://github.com/prismalens/prismalens/commit/f0a0430ca19a619c339ce1a8a5a96d379fe1a76a))
* **runs:** review of [#922](https://github.com/prismalens/prismalens/issues/922): multi-repo scope line, a folder's missing commit named, the boot sweep survives a stuck entry, the handoff transcript where the agent starts ([0a068db](https://github.com/prismalens/prismalens/commit/0a068db7ae8d19bbce1de9c5255a8383b46d29a1))
* **runs:** review round 1 on run workspaces ([#925](https://github.com/prismalens/prismalens/issues/925)) ([1c233c6](https://github.com/prismalens/prismalens/commit/1c233c66804d34c47784dd093e3be40bdde5634f))
* **runs:** review round 2 on run workspaces ([#925](https://github.com/prismalens/prismalens/issues/925)) ([4f641df](https://github.com/prismalens/prismalens/commit/4f641df4526a0272e6ba1be72dd0743f6cb34f90))
* **runs:** second Codex pass on run workspaces: a pl-* location keeps its runs' liveness, a follow-up waits for a running sweep, a linked run folder is never followed, an earlier version's changed clone stays, Files to copy in keeps a new line ([#925](https://github.com/prismalens/prismalens/issues/925)) ([4e9bc51](https://github.com/prismalens/prismalens/commit/4e9bc5150fc5c4abb6c171a5c55dba32aa5a3708))
* **settings,doctor:** answer the CodeRabbit review on [#911](https://github.com/prismalens/prismalens/issues/911) ([5c086c0](https://github.com/prismalens/prismalens/commit/5c086c0ea760c199bdb1bda5d69880766bdad1b0))
* **settings:** Add agent's registry search and steps fit a phone; e2e checks inEnv ([ca5ba0f](https://github.com/prismalens/prismalens/commit/ca5ba0f17381a12ade36dd9c559433421c2b9e13))


### Performance Improvements

* **frontend:** the run page does work only when something on it changes ([0d0bac8](https://github.com/prismalens/prismalens/commit/0d0bac8838c93c9a21230edb543cb70154d907aa))

## [0.5.2](https://github.com/prismalens/prismalens/compare/v0.5.1...v0.5.2) (2026-10-23)


### Features

* **agent-adapters:** publish the package to npm with its adapters bundled and no native agent copies ([cfb6f25](https://github.com/prismalens/prismalens/commit/cfb6f2589ff634f43d2b54dccc16419e1f968698))


### Bug Fixes

* **#897:** milestone close-out warning returns, splash shows once, RELEASING scoped to 0.x with a patch-vs-minor table ([8f78851](https://github.com/prismalens/prismalens/commit/8f78851abbd5bb8b7fda6ff3993e9f4244e5721c))
* **#897:** phase-gate takes only 0.x milestones, findings wording matches the templates, desktop splash outlives no failed load ([6d22e63](https://github.com/prismalens/prismalens/commit/6d22e639d828c34e6f22932e82eed0f6585a1284))
* **#902:** side checks make their temp root only when they run ([687a2b7](https://github.com/prismalens/prismalens/commit/687a2b78fef16afe7fa5821eb15928018a752100))
* **#902:** versionOf resolves null when Windows refuses to exec the file ([abe3713](https://github.com/prismalens/prismalens/commit/abe37131b7615729d24a78f927008b91cae96c31))
* 0.5.2 walk findings (side checks on Windows, app-boot EINVAL retry, DEP0190, flagged-content location) ([a5a3920](https://github.com/prismalens/prismalens/commit/a5a39209efa5cf3251c294a6bfc8665d2a9fc987))
* 0.5.2 walk findings (side checks on Windows, app-boot EINVAL retry, DEP0190, flagged-content location) ([7fcee0e](https://github.com/prismalens/prismalens/commit/7fcee0ef723bc628cecc563363711831e415ab20)), closes [#902](https://github.com/prismalens/prismalens/issues/902)
* **agent-adapters:** pin npm for trusted publishing, build before pack:npm, remove the staging dir ([d5c9841](https://github.com/prismalens/prismalens/commit/d5c9841a57564c04d1bde165621cd00af56f5327))
* **api:** a run's snapshot can't push to the user's checkout or the mirror ([87441f9](https://github.com/prismalens/prismalens/commit/87441f9d926f0adcfafd3b7105bf3a946cffe4cb))
* **api:** a run's snapshot can't push to the user's checkout or the mirror ([0d5697d](https://github.com/prismalens/prismalens/commit/0d5697d47433fdadf8a29ebb8db9294195b17fd3))
* **api:** the demo seed runs on Windows ([fbb446e](https://github.com/prismalens/prismalens/commit/fbb446e5107605f5cf2e262a5776d5c347432eb4))
* **api:** the demo seed runs on Windows ([79b18ac](https://github.com/prismalens/prismalens/commit/79b18acb7ff2a35aecd4286e21b85fcc1b5b5da4))
* **ci:** follow the new free model in the picker e2e and the R6 user model ([927028f](https://github.com/prismalens/prismalens/commit/927028ff544efb41b4fd22a3b1f30fcde8099e4c))
* **ci:** opencode free model moved to deepseek-v4.1-flash-free ([9da8e4f](https://github.com/prismalens/prismalens/commit/9da8e4fe325aa6778e5fab4ec9b33240dc08ed97))
* **ci:** opencode free model moved to deepseek-v4.1-flash-free ([fbb9fe9](https://github.com/prismalens/prismalens/commit/fbb9fe9302b6d7545b1c9c696800a160d4857354))
* **ci:** packed intake investigates a small fixture repo ([#876](https://github.com/prismalens/prismalens/issues/876)) ([64690c7](https://github.com/prismalens/prismalens/commit/64690c7a1e0264225273b6013aec253cac873a01))
* **ci:** packed intake investigates a small fixture repo, not the whole checkout ([#876](https://github.com/prismalens/prismalens/issues/876)) ([995ead8](https://github.com/prismalens/prismalens/commit/995ead816837228f1eb7dcec1d695069ee575c45))
* **ci:** packed-upgrade-smoke seeds the migrations before investigation_turns, not all but it (refs [#885](https://github.com/prismalens/prismalens/issues/885)) ([7280304](https://github.com/prismalens/prismalens/commit/72803049b16220fb7096a73d2407a88e3c66cf80))
* **deps:** TanStack Start to the patched release for GHSA-qx66-fv34-fjm8 ([f0840be](https://github.com/prismalens/prismalens/commit/f0840bef14559b49550f54888ed86bc4dc8f1128))
* **deps:** TanStack Start to the patched release for GHSA-qx66-fv34-fjm8 ([d6c942a](https://github.com/prismalens/prismalens/commit/d6c942aed61774c785ab7e868c2d45f3dd1996c4))
* **engine:** keep a Codex tool's output from an earlier update when the completed update is bare ([7f0c00b](https://github.com/prismalens/prismalens/commit/7f0c00be0a8bb314f0d77aa55100acb854b3208c))
* **engine:** list the session updates ACP SDK 1.9.0 adds in the drift guard ([465519c](https://github.com/prismalens/prismalens/commit/465519cb58950323a6a164490bb086f65ebaa773))
* **engine:** preview Codex tool output from rawOutput ([11dd8aa](https://github.com/prismalens/prismalens/commit/11dd8aaafed7f3496947a89ed7602ef80f9f7f3e))
* **engine:** preview Codex tool output from rawOutput ([5c3131d](https://github.com/prismalens/prismalens/commit/5c3131d7c8c3e4d4abc5e359da7e71b15799f269))
* **install:** the Windows installer extracts within the path limit ([723e8ec](https://github.com/prismalens/prismalens/commit/723e8ecde9fa5034b0b3fc035e456c3f887be79c))
* **install:** the Windows installer extracts within the path limit ([a93334c](https://github.com/prismalens/prismalens/commit/a93334cf39aa9701e37fdb8c29f6ed01eee74710)), closes [#902](https://github.com/prismalens/prismalens/issues/902)

## [0.5.1](https://github.com/prismalens/prismalens/compare/v0.5.0...v0.5.1) (2026-10-13)


### ⚠ BREAKING CHANGES

* the GitHub App template, Post to GitHub and the repository import picker are removed, with their routes (installations, /report/github, /git/organizations, /git/repositories, /repositories/batch) and the unused OAuth routes. Saved GitHub App connections show as removed with Delete only; saved GitHub token connections keep cloning for their host.
* remove the Plan mode; runs always execute under their permission level ([#673](https://github.com/prismalens/prismalens/issues/673))
* **harness:** supported agents on their own sign-in, no safety verdict, no placement ([#634](https://github.com/prismalens/prismalens/issues/634)) (#707)
* **auth:** no account on the instance; the host pairs through a startup link ([#698](https://github.com/prismalens/prismalens/issues/698)) (#701)

### Features

* [#673](https://github.com/prismalens/prismalens/issues/673) readiness: pairing proven on the packed tarball, fidelity line, stranger-repo replay ([#711](https://github.com/prismalens/prismalens/issues/711)) ([280c2e8](https://github.com/prismalens/prismalens/commit/280c2e85d666c31b9e40cc4c2d90af90b7ff6021))
* **#820:** asks open in a dock on the message box, not the transcript ([91982d1](https://github.com/prismalens/prismalens/commit/91982d1ece61d086615beabcb8f73aca3e270234))
* a run reads every repo the incident touches, and a finished investigation takes a follow-up in the same session ([#747](https://github.com/prismalens/prismalens/issues/747)) ([#751](https://github.com/prismalens/prismalens/issues/751)) ([905b8da](https://github.com/prismalens/prismalens/commit/905b8da26a39bd29382a1574b87f9fdc07e1b246))
* **agents:** ship the ACP adapters; alert-started runs refuse asks; Settings shows only what it checked ([#818](https://github.com/prismalens/prismalens/issues/818)) ([1c3f747](https://github.com/prismalens/prismalens/commit/1c3f747fe4b9a2ae7a880200371ab3f978548ed3))
* **alerts:** an incident resolves when no connected Alertmanager lists its alerts any more ([#605](https://github.com/prismalens/prismalens/issues/605)) ([#728](https://github.com/prismalens/prismalens/issues/728)) ([0e9c74b](https://github.com/prismalens/prismalens/commit/0e9c74b32a52251d17055aa26617bc3848df8348))
* an ask's window ends a minute before the run's wall clock, and the card says so ([#673](https://github.com/prismalens/prismalens/issues/673) w21) ([1aec062](https://github.com/prismalens/prismalens/commit/1aec062b108e7e2b5fd86751a7ba55c7f2b78026))
* **api,engine:** custom models per agent; an added model goes in through the agent's env ([#673](https://github.com/prismalens/prismalens/issues/673) w57) ([85ff35b](https://github.com/prismalens/prismalens/commit/85ff35bdfa92a6391b2a7dd51cd4aa73095b8e49))
* **api,engine:** the context pack names the affected service's upstream dependencies too ([#673](https://github.com/prismalens/prismalens/issues/673) walk 4) ([a5565ac](https://github.com/prismalens/prismalens/commit/a5565ac5662b84825910040c289364c7c1befd1e))
* **api:** a thread's end follows the settlement table; the run owns its row's end ([#673](https://github.com/prismalens/prismalens/issues/673) w59) ([81e3cde](https://github.com/prismalens/prismalens/commit/81e3cde7b6634cddab58364524298d4d33834f7c))
* **api:** a waiting ask is stored, answered over the API, and denied at restart ([#673](https://github.com/prismalens/prismalens/issues/673) w21) ([97ebf09](https://github.com/prismalens/prismalens/commit/97ebf09dd2e5f56ae5909f4d70834df1a3e32481))
* **api:** attachments, the access ceiling, effort and continue on the run path ([c707f96](https://github.com/prismalens/prismalens/commit/c707f96592a9e608cb7e297c52f7b648775056c9))
* **api:** merge one incident into another ([#673](https://github.com/prismalens/prismalens/issues/673) w37) ([cfeb6e3](https://github.com/prismalens/prismalens/commit/cfeb6e308786dad373b1059a5dac73ae787250d5))
* **api:** runs carry agentMode; no write-level ceiling ([#673](https://github.com/prismalens/prismalens/issues/673) w21) ([159307f](https://github.com/prismalens/prismalens/commit/159307f91f5ae97a313bc716033e26aafd4038a3))
* **api:** stop-the-impact options and the live Impact chart ([#811](https://github.com/prismalens/prismalens/issues/811)) ([72e7e78](https://github.com/prismalens/prismalens/commit/72e7e78357f5eb44e23a2262677b2fd103eb490b))
* **api:** the Impact chart's unit, from the metric names ([#811](https://github.com/prismalens/prismalens/issues/811)) ([a096263](https://github.com/prismalens/prismalens/commit/a09626390baeb34ce990542124f24d3ae9b1ba3c))
* **api:** what changed around an incident, read from its git hosts ([#811](https://github.com/prismalens/prismalens/issues/811)) ([d23d644](https://github.com/prismalens/prismalens/commit/d23d64404d66b3bf0f7cee14b9ae9d4717d2d1ad))
* **api:** what changed, ranked fixes and the impact chart for the incident overview ([#811](https://github.com/prismalens/prismalens/issues/811)) ([77717e6](https://github.com/prismalens/prismalens/commit/77717e6adb94bcfa6e4014c5ed3d1127a02ccaf9))
* **auth:** devices pair with the host ([#698](https://github.com/prismalens/prismalens/issues/698)) ([#700](https://github.com/prismalens/prismalens/issues/700)) ([5fea4ec](https://github.com/prismalens/prismalens/commit/5fea4ecb4a17eae59413d646c96bed0c65219087))
* **auth:** no account on the instance; the host pairs through a startup link ([#698](https://github.com/prismalens/prismalens/issues/698)) ([#701](https://github.com/prismalens/prismalens/issues/701)) ([c8f9ea6](https://github.com/prismalens/prismalens/commit/c8f9ea6f4a9f8f9cb8fa00ff533f64e1f34c119b))
* **cli:** a failed service upgrade rolls back to the previous version and database ([#766](https://github.com/prismalens/prismalens/issues/766)) ([#770](https://github.com/prismalens/prismalens/issues/770)) ([ccf3624](https://github.com/prismalens/prismalens/commit/ccf362409be0e0b7fcdaf16d098ecc85e1eb7dc4))
* **cli:** pl service runs PrismaLens in the background on Linux and macOS ([#732](https://github.com/prismalens/prismalens/issues/732)) ([#735](https://github.com/prismalens/prismalens/issues/735)) ([0f88ed0](https://github.com/prismalens/prismalens/commit/0f88ed0936940339f977139bdc87fb01487cf519))
* **cli:** reach the box from anywhere over Tailscale HTTPS ([#765](https://github.com/prismalens/prismalens/issues/765)) ([#768](https://github.com/prismalens/prismalens/issues/768)) ([db4d899](https://github.com/prismalens/prismalens/commit/db4d899267a24c23330ebd40863c6f79b61bbf10))
* clone with a git host token or your own git login, and show which one ([#673](https://github.com/prismalens/prismalens/issues/673)) ([b2ffbb2](https://github.com/prismalens/prismalens/commit/b2ffbb29de76dcd123bde882e8481566949982f2))
* clone with a git host token or your own git login, and show which one ([#673](https://github.com/prismalens/prismalens/issues/673)) ([0acd51b](https://github.com/prismalens/prismalens/commit/0acd51ba1aa9cc2580777a49d963b0ec0f7561c8))
* **config,contracts:** a run's mode is the agent's own ACP mode id ([#673](https://github.com/prismalens/prismalens/issues/673) w21) ([1433de6](https://github.com/prismalens/prismalens/commit/1433de6e4766fc103dccd0e5e89ecb0c2920108d))
* **config,contracts:** four permission levels and two run modes per agent ([#673](https://github.com/prismalens/prismalens/issues/673)) ([cd6b000](https://github.com/prismalens/prismalens/commit/cd6b000daa794c9a9f0b1ff6556f9d620e9bb6fb))
* **contracts,database:** a thread's live turn and last-message outcome ([#673](https://github.com/prismalens/prismalens/issues/673) w59) ([db63acf](https://github.com/prismalens/prismalens/commit/db63acfe0f1d69b50e6bb25bdbcea1cb59e90911))
* **database,api:** store each run's level and mode, auto-started rows, strip instruction files, service notes ([#673](https://github.com/prismalens/prismalens/issues/673)) ([a5f5b7e](https://github.com/prismalens/prismalens/commit/a5f5b7e6e544169f60013d630f3fa0c83d01d750))
* **desktop:** a branded window frame with native controls in the app's colours ([#736](https://github.com/prismalens/prismalens/issues/736)) ([#737](https://github.com/prismalens/prismalens/issues/737)) ([96b99b4](https://github.com/prismalens/prismalens/commit/96b99b40d86d565b8dd1269b010f5c707586425d))
* **desktop:** add hot-reload dev script for the Electron app ([5a385ef](https://github.com/prismalens/prismalens/commit/5a385ef7d4703cd30a910436bd0d623a41afefb5))
* **desktop:** an empty, draggable title row holds the window controls ([#819](https://github.com/prismalens/prismalens/issues/819)) ([f8c7f3c](https://github.com/prismalens/prismalens/commit/f8c7f3c4000b4d8fbf9f1fd1cf77ab316e830193))
* **desktop:** the Electron launcher spawns the backend and adds presence ([#83](https://github.com/prismalens/prismalens/issues/83)) ([#702](https://github.com/prismalens/prismalens/issues/702)) ([2199435](https://github.com/prismalens/prismalens/commit/2199435e1826941859e9f1859be3aacd5326d150))
* **engine,api:** a follow-up on an older run tells the agent a newer run saw newer commits ([#673](https://github.com/prismalens/prismalens/issues/673) w27) ([92aaf46](https://github.com/prismalens/prismalens/commit/92aaf461b3a44d491c884105553feff4168f047c))
* **engine:** check each agent mode's own sandbox, and rest enforced on it ([#673](https://github.com/prismalens/prismalens/issues/673) w51) ([a0c93ea](https://github.com/prismalens/prismalens/commit/a0c93ea0394ee3c6545f5469da45c820a8494f4d))
* **engine:** model and effort over ACP config options, attachments as prompt content, continue a stopped run ([132c1eb](https://github.com/prismalens/prismalens/commit/132c1ebf97e196e87b4a4bea1a165e9662c77e66))
* **engine:** no PrismaLens permission gate; the agent's own mode is the limit ([#673](https://github.com/prismalens/prismalens/issues/673) w21) ([07fd396](https://github.com/prismalens/prismalens/commit/07fd396a7fa201a0f2fe7c1f4f4eb8411e1b387c))
* **engine:** set the agent's own mode, fail fast when it is not offered ([#673](https://github.com/prismalens/prismalens/issues/673) w21, w26) ([470a6a3](https://github.com/prismalens/prismalens/commit/470a6a3da35c8f2e7177edbbe7af5509d827db6b))
* **engine:** the agent's own mode decides and every ask waits on you ([#673](https://github.com/prismalens/prismalens/issues/673) w21) ([7faa2a5](https://github.com/prismalens/prismalens/commit/7faa2a571e2a7da4d0d3a4dc47c64db88504f0d8))
* **engine:** the run's level answers asks, Plan keeps its plan, the reported mode is recorded ([#673](https://github.com/prismalens/prismalens/issues/673)) ([87b35a8](https://github.com/prismalens/prismalens/commit/87b35a89f0dd69bf312a43c4af7f06015db01d54))
* four permission levels, your agent's default seeds them ([#673](https://github.com/prismalens/prismalens/issues/673)) ([8016dd8](https://github.com/prismalens/prismalens/commit/8016dd8ba396a45e1120335a824816a453da3c00))
* **frontend,brand:** the refraction mark in the app, a favicon, and the new banners ([#703](https://github.com/prismalens/prismalens/issues/703)) ([d809685](https://github.com/prismalens/prismalens/commit/d809685371591c7eacfb5f64529933feada7f560))
* **frontend,desktop:** production UX pass on web and desktop; the mobile top bar fits 375px ([#723](https://github.com/prismalens/prismalens/issues/723)) ([#726](https://github.com/prismalens/prismalens/issues/726)) ([32fb7c6](https://github.com/prismalens/prismalens/commit/32fb7c660215b963bdc0d4002f1650983ae20f4a))
* **frontend:** a run strip, bounded incident cards, a chat conversation with its box, and the board ([#743](https://github.com/prismalens/prismalens/issues/743)) ([#750](https://github.com/prismalens/prismalens/issues/750)) ([5fba10a](https://github.com/prismalens/prismalens/commit/5fba10a690f7d7108958b11cd3a4afc037fdad89))
* **frontend:** Add custom model in Settings, Agent; the picker lists added models and marks the env's model ([#673](https://github.com/prismalens/prismalens/issues/673) w57) ([f03b1da](https://github.com/prismalens/prismalens/commit/f03b1da6b14825410674eeed482498eaf9bc6f0c))
* **frontend:** an older run says A newer run (Run #N) looks at &lt;sha&gt;, with a link ([#673](https://github.com/prismalens/prismalens/issues/673) w27) ([1cc16f4](https://github.com/prismalens/prismalens/commit/1cc16f4b206fdb0a72104300bd56ffbb508c0f69))
* **frontend:** Approve or Deny in the conversation; the board, band and sidebar say Waiting for your approval ([#673](https://github.com/prismalens/prismalens/issues/673) w21) ([7f1a04b](https://github.com/prismalens/prismalens/commit/7f1a04b98398573f9f098bd2ce53b045b026ca04))
* **frontend:** board heads and cards on the ladder, Settled fold, Resolved drop on Concluded reopens ([#673](https://github.com/prismalens/prismalens/issues/673) w14, w42) ([edd4f83](https://github.com/prismalens/prismalens/commit/edd4f83c174b3ef9618f3159c18ca66f6a8eda25))
* **frontend:** frame, first run, settings and services design pass ([#673](https://github.com/prismalens/prismalens/issues/673) w4, w11, w16, w17, w45) ([d889ed5](https://github.com/prismalens/prismalens/commit/d889ed55336febd3091f33d924d71f5fca318866))
* **frontend:** lock the mode chip only where the sandbox check says enforced ([#673](https://github.com/prismalens/prismalens/issues/673) w51) ([d4c40c6](https://github.com/prismalens/prismalens/commit/d4c40c679e8e5475327fe06c4d13392f6f8d127f))
* **frontend:** look pass B, C and D — lists, record and picker, settings ([f3aa061](https://github.com/prismalens/prismalens/commit/f3aa06153fa09627ade78c581620a200957807d8))
* **frontend:** look pass B, the lists on the new system (WIP) ([cd6791d](https://github.com/prismalens/prismalens/commit/cd6791d32670f4454ebbecb1f96818ae45b54c82))
* **frontend:** Merge into… from the incident band ([#673](https://github.com/prismalens/prismalens/issues/673) w37) ([49fa7e2](https://github.com/prismalens/prismalens/commit/49fa7e219c37a1fd2ea50eb6cee20a85fab41318))
* **frontend:** one chip for Execute or Plan and the four levels, Settings rows for next and auto-started runs ([#673](https://github.com/prismalens/prismalens/issues/673)) ([36346d9](https://github.com/prismalens/prismalens/commit/36346d91247f00bda4f980f10aaef0112020bc39))
* **frontend:** one look system — surface shades, semantic colour, shared controls and motion ([0e8800d](https://github.com/prismalens/prismalens/commit/0e8800d5a8ca0ad8fdb3ec6e91c0853bc63c12ae))
* **frontend:** one primitive per job: Hint, Select, Tabs, Segmented, Row, State, Toast ([77835fc](https://github.com/prismalens/prismalens/commit/77835fc5483c3b15403bc44518befd65e22ed041))
* **frontend:** one send control and a verb chip where both verbs act; Working reads the live turn ([#673](https://github.com/prismalens/prismalens/issues/673) w59) ([7850541](https://github.com/prismalens/prismalens/commit/7850541bfa99c7df24723930b084f8661bc8c79c))
* **frontend:** one sidebar, incident tabs, and an Overview that opens with a summary ([#743](https://github.com/prismalens/prismalens/issues/743)) ([#748](https://github.com/prismalens/prismalens/issues/748)) ([da22975](https://github.com/prismalens/prismalens/commit/da229753cda2ba26d9c19422600afdc9b5d73f1c))
* **frontend:** one visual system and one shell — sidebar doors, Back everywhere, Alerts and devices redesigned ([#779](https://github.com/prismalens/prismalens/issues/779)) ([85636b3](https://github.com/prismalens/prismalens/commit/85636b3727ea38f8798d9a3edfe5bf12be9f41e4))
* **frontend:** one-column incident page, no rail and no Event log; hero report ([#673](https://github.com/prismalens/prismalens/issues/673) w12, w13, w18, w29, w36) ([031585c](https://github.com/prismalens/prismalens/commit/031585c44b3def7b1621befba5b22862ee926559))
* **frontend:** overview impact values in the metric's unit, Resolve stops the live run, dead investigation code removed ([#811](https://github.com/prismalens/prismalens/issues/811)) ([5770f9e](https://github.com/prismalens/prismalens/commit/5770f9e7cf2f9b92c8cc6ed2c1345f7f1b83dd3e))
* **frontend:** record, conversation, report and picker on the new system ([937ff3a](https://github.com/prismalens/prismalens/commit/937ff3a9215c029d6002afffbedba327aac27e36))
* **frontend:** record, conversation, report and picker on the new system (WIP) ([c1f54a1](https://github.com/prismalens/prismalens/commit/c1f54a15313dcfead919c3c759e7acc8e72ec58d))
* **frontend:** run and Ask pages, Run details panel, runs menu ([#811](https://github.com/prismalens/prismalens/issues/811)) ([f42e7bb](https://github.com/prismalens/prismalens/commit/f42e7bbf71afd7f9bce3a39c9f9db7aa53a571ce))
* **frontend:** run transcript, Ask conversation and the Run details panel ([#811](https://github.com/prismalens/prismalens/issues/811)) ([a84ff36](https://github.com/prismalens/prismalens/commit/a84ff362fe0c071ee0975ba3fcc01cedb1fdb825))
* **frontend:** runs live in the sidebar under their incident; the Run chip below 1280 ([#673](https://github.com/prismalens/prismalens/issues/673)) ([23520c8](https://github.com/prismalens/prismalens/commit/23520c85906e2f41025294c9c8d5716f8ce28acd))
* **frontend:** settings on pools and rows ([6f9ea26](https://github.com/prismalens/prismalens/commit/6f9ea266b3ba8d78cbd601885b24064b8293f8b9))
* **frontend:** Settings sections, Alert sources, Services on one page and the agent picker ([#781](https://github.com/prismalens/prismalens/issues/781)) ([75ae038](https://github.com/prismalens/prismalens/commit/75ae038b64def06bd25d6b0bf0da8ed69f3d3d2a))
* **frontend:** Settings, Agent says what OpenCode asks about ([#673](https://github.com/prismalens/prismalens/issues/673) w21) ([028e47c](https://github.com/prismalens/prismalens/commit/028e47c0a7b4b5a8a55dc8666b74f6035562110b))
* **frontend:** surface ladder, text and solid tokens, and the motion sheet ([e2222db](https://github.com/prismalens/prismalens/commit/e2222db4a37c2e5d41540914d3006f5f5e30a7ed))
* **frontend:** the board, first run, Analytics and one-step Resolve ([#780](https://github.com/prismalens/prismalens/issues/780)) ([266d896](https://github.com/prismalens/prismalens/commit/266d89667bee82505fbcdc9bc412a4c663fddf57))
* **frontend:** the box on PromptInput with the same three chips in every run state ([#673](https://github.com/prismalens/prismalens/issues/673) w7, w9, w10, w21, w33) ([b2b75ce](https://github.com/prismalens/prismalens/commit/b2b75ce097d46b95cf398172053413b30230217b))
* **frontend:** the box's chips change only that run ([#673](https://github.com/prismalens/prismalens/issues/673) w52) ([21c6756](https://github.com/prismalens/prismalens/commit/21c6756abc8c7ff64f13dca7a89b86b8e486aadd))
* **frontend:** the conversation on AI Elements and Streamdown, the box's modes, access, effort and attachments ([7fbc9d3](https://github.com/prismalens/prismalens/commit/7fbc9d3927ecfe1c8542e1a96e6e807c71e3fe69))
* **frontend:** the inbox replaces the board; one sidebar with incidents under their services ([#811](https://github.com/prismalens/prismalens/issues/811)) ([737aad4](https://github.com/prismalens/prismalens/commit/737aad465d5b80b36780ff80af2743f030e64f1b))
* **frontend:** the Inbox replaces the incident board, one sidebar tree for every page ([#811](https://github.com/prismalens/prismalens/issues/811)) ([98d3ee8](https://github.com/prismalens/prismalens/commit/98d3ee89ef3555f884ce4f7ab1f44e40cadb1560))
* **frontend:** the incident overview is one page with no tabs ([#811](https://github.com/prismalens/prismalens/issues/811)) ([8833870](https://github.com/prismalens/prismalens/commit/8833870ae9c057ffa0655d457bd32d4dcfa8d2ae))
* **frontend:** the incident record and its report as designed pages ([2064d70](https://github.com/prismalens/prismalens/commit/2064d7054cae11213b8ae8a6f6f34b789d4684c7))
* **frontend:** the incident record and its report as designed pages ([11a70a3](https://github.com/prismalens/prismalens/commit/11a70a372cfbd323442f26f3c296c1cc3d5e8bed))
* **frontend:** the legacy form dialogs speak Resolve's language ([11c6867](https://github.com/prismalens/prismalens/commit/11c68672596d9251fa2c2747dc6714e426ac6c67))
* **frontend:** the mode chip lists the agent's own modes ([#673](https://github.com/prismalens/prismalens/issues/673) w21) ([aeb7e74](https://github.com/prismalens/prismalens/commit/aeb7e7446bf47f9f93fd6b8e6a7d091fa482a2b9))
* **frontend:** the one-page incident overview ([#811](https://github.com/prismalens/prismalens/issues/811)) ([d6c19ef](https://github.com/prismalens/prismalens/commit/d6c19ef3fc757c650fdeb4e26ded8a8ea22de263))
* **frontend:** the reshape — 32 surfaces to 17 ([#523](https://github.com/prismalens/prismalens/issues/523)) ([#694](https://github.com/prismalens/prismalens/issues/694)) ([4685bca](https://github.com/prismalens/prismalens/commit/4685bcac073438474b7b9679c58233491b2827c1))
* **frontend:** the run strip goes grey and stops its clock while the stream is lost ([db3ec73](https://github.com/prismalens/prismalens/commit/db3ec73b3ad77cf41f89e752b712067dbed012aa))
* **frontend:** the shell on the new system ([a1797fe](https://github.com/prismalens/prismalens/commit/a1797fe5f3daef2759f4c1641a8060f03426c377))
* **frontend:** vendor AI Elements prompt-input and model-selector, shadcn command and input-group ([#673](https://github.com/prismalens/prismalens/issues/673)) ([6043484](https://github.com/prismalens/prismalens/commit/6043484d15d1cfadaba553ae9a95bccd84116b4d))
* **harness:** a model catalogue, models per agent, drift logged, a run refuses what the agent lacks ([#639](https://github.com/prismalens/prismalens/issues/639)) ([#704](https://github.com/prismalens/prismalens/issues/704)) ([2c968a2](https://github.com/prismalens/prismalens/commit/2c968a2e086275fdd1a1f7902c677eaaeb7ba405))
* **harness:** Gemini CLI never loads the incident repo's own config ([#634](https://github.com/prismalens/prismalens/issues/634)) ([#755](https://github.com/prismalens/prismalens/issues/755)) ([fc27a89](https://github.com/prismalens/prismalens/commit/fc27a895c45f09d4edb25aa8ff7afd5753437560))
* **harness:** record the model the agent reports, flag a substitution, and drop the read-only claim from the report chip ([#639](https://github.com/prismalens/prismalens/issues/639)) ([#727](https://github.com/prismalens/prismalens/issues/727)) ([06d319d](https://github.com/prismalens/prismalens/commit/06d319d596ce0d20e6b8d225571490021d23bce6))
* **harness:** supported agents on their own sign-in, no safety verdict, no placement ([#634](https://github.com/prismalens/prismalens/issues/634)) ([#707](https://github.com/prismalens/prismalens/issues/707)) ([cd00535](https://github.com/prismalens/prismalens/commit/cd00535b22633cf98c5d587fe0d25066ee831521))
* header menu writes a status update and changes severity; Resolve confirms while firing ([#811](https://github.com/prismalens/prismalens/issues/811)) ([439461f](https://github.com/prismalens/prismalens/commit/439461f681b1d7828d9bb437c533039c42bc9318))
* **inbox:** a quiet Working group under Needs you; every page of active incidents ([#811](https://github.com/prismalens/prismalens/issues/811)) ([3b014fc](https://github.com/prismalens/prismalens/commit/3b014fce53ce3491eb95ec0a4d103d98646a4bbe))
* **install:** the whole lifecycle on every channel: pl upgrade, PATH, fallback, rollback, uninstall, and guards for two copies and downgrades ([#717](https://github.com/prismalens/prismalens/issues/717)) ([#721](https://github.com/prismalens/prismalens/issues/721)) ([46d360e](https://github.com/prismalens/prismalens/commit/46d360eb1837e41ed981f4a731cac4d4899f373a))
* investigation and chat are two kinds of one thread ([#673](https://github.com/prismalens/prismalens/issues/673) w59) ([722d4ea](https://github.com/prismalens/prismalens/commit/722d4eaf3db61ec3961443dd74886a9c3ec1df44))
* merge incidents, run-only chips, sandbox-proven lock ([#673](https://github.com/prismalens/prismalens/issues/673) w37, w51, w52) ([224b0e9](https://github.com/prismalens/prismalens/commit/224b0e979565daf246d572ffd06d69787ce60ff8))
* message a running investigation, stop it from anywhere, run state in its own words ([#743](https://github.com/prismalens/prismalens/issues/743)) ([#744](https://github.com/prismalens/prismalens/issues/744)) ([ce41bca](https://github.com/prismalens/prismalens/commit/ce41bca457c8b063d4a9ff520d10d137a10e1d23))
* pull alerts on open from Alertmanager, catch up from Prometheus ([#680](https://github.com/prismalens/prismalens/issues/680)) ([b6e6a77](https://github.com/prismalens/prismalens/commit/b6e6a7792478d1608b4289ea7197c396a3ae1695))
* rebrand to the p-lens glint mark ([#745](https://github.com/prismalens/prismalens/issues/745)) ([#746](https://github.com/prismalens/prismalens/issues/746)) ([2e72095](https://github.com/prismalens/prismalens/commit/2e7209572ef3ff271ca29e255f6390fecedf3cc2))
* remove the Plan mode; runs always execute under their permission level ([#673](https://github.com/prismalens/prismalens/issues/673)) ([f7a3f72](https://github.com/prismalens/prismalens/commit/f7a3f727ddee9a38a7ccd86a54edf9b7577f2104))
* **runs:** a run carries its own agent, model and effort ([#673](https://github.com/prismalens/prismalens/issues/673) w52) ([afbd26e](https://github.com/prismalens/prismalens/commit/afbd26e83385b5965161c34587308d9a83ce6795))
* **runs:** a run is a thread, an investigation or a chat ([#673](https://github.com/prismalens/prismalens/issues/673)) ([dbf6b7b](https://github.com/prismalens/prismalens/commit/dbf6b7b1b48a8638402af8ec0d49259da56fa6d6))
* screens reach one PrismaLens per workspace without breaking each other ([#763](https://github.com/prismalens/prismalens/issues/763)) ([#764](https://github.com/prismalens/prismalens/issues/764)) ([90e021b](https://github.com/prismalens/prismalens/commit/90e021b46ec09055e2341fe51c8dcd51e9d8f454))
* ship the ACP adapters, alert-started runs refuse asks, honest versions and tokens ([#818](https://github.com/prismalens/prismalens/issues/818)) ([f20e843](https://github.com/prismalens/prismalens/commit/f20e8433d72f423dc7c24d7204894b15a80ae99e))
* **telemetry:** EU project, day timestamps, run mode and build, daily presence, recently sent ([#602](https://github.com/prismalens/prismalens/issues/602)) ([#716](https://github.com/prismalens/prismalens/issues/716)) ([3a30a11](https://github.com/prismalens/prismalens/commit/3a30a1134f4ef27f4697805d6a025033a8c34bab))
* **telemetry:** usage data is on after a first-run notice, off by setting or env ([#673](https://github.com/prismalens/prismalens/issues/673) w45) ([e39ecdd](https://github.com/prismalens/prismalens/commit/e39ecdd7641e3065b7ca97729d9ecf0d58570e43))
* the agent's own mode decides, asks reach you, custom models ([#673](https://github.com/prismalens/prismalens/issues/673)) ([87b583c](https://github.com/prismalens/prismalens/commit/87b583c7b43ed8a8e36388ce893e034b497c2e3c))
* the conversation, the box, model and effort over ACP, attachments and continue ([d8583e1](https://github.com/prismalens/prismalens/commit/d8583e1dad450db56c5805344e270fc47e81a0e1))
* the incident band in the desktop title strip, and a follow-up that ends early puts its run back ([#752](https://github.com/prismalens/prismalens/issues/752)) ([#756](https://github.com/prismalens/prismalens/issues/756)) ([bd56d18](https://github.com/prismalens/prismalens/commit/bd56d186e551ca185ae1c3f82c0d0a68807a54e5))
* **ui:** frame, board, settings and services design pass D2 ([#673](https://github.com/prismalens/prismalens/issues/673)) ([46d2d6f](https://github.com/prismalens/prismalens/commit/46d2d6fc06b19ad3981ec9a69b4afd3f5791b718))
* **ui:** incident record design pass D1 ([#673](https://github.com/prismalens/prismalens/issues/673)) ([09504c9](https://github.com/prismalens/prismalens/commit/09504c9332c668014f5bc501716b612398bde00c))


### Bug Fixes

* "No sandbox on this machine." and arrow keys in the agent chips ([#811](https://github.com/prismalens/prismalens/issues/811)) ([d0a2aec](https://github.com/prismalens/prismalens/commit/d0a2aecd0f16fe2e7cf98435638a1096db443d91))
* [#673](https://github.com/prismalens/prismalens/issues/673) w7-4 Claude Code runs without plan-mode tools; a held mode never fails the run ([cb14af2](https://github.com/prismalens/prismalens/commit/cb14af2e03a846537f3f5c9d271f9741d84ca488))
* [#673](https://github.com/prismalens/prismalens/issues/673) w7-8 no Check now for an alert the check cannot judge; a reload keeps no-retry ([1bdee56](https://github.com/prismalens/prismalens/commit/1bdee56a5ff49bd7f00676d5c133f7f4fa583dad))
* [#673](https://github.com/prismalens/prismalens/issues/673) w7-8 regenerate openapi.json and give the e2e impact mocks checkable ([d9d6048](https://github.com/prismalens/prismalens/commit/d9d6048447e5c52693a48fb4dd984c0c612adff9))
* [#673](https://github.com/prismalens/prismalens/issues/673) walk 7 majors: mode hold, report JSON, rule denials, standing finding ([61ee28b](https://github.com/prismalens/prismalens/commit/61ee28b6abf41e56d46cdf19973529c26d8bc85c))
* [#673](https://github.com/prismalens/prismalens/issues/673) walk 8 packet 1 (w8-2, w8-5, w8-7, w8-8, w8-9) ([054bfdc](https://github.com/prismalens/prismalens/commit/054bfdc1a27150a9d0b45cfcb82ca8ab720edc76))
* [#673](https://github.com/prismalens/prismalens/issues/673) walk 8 packet 2 (w8-11..w8-18, 2c) ([a1d4f6e](https://github.com/prismalens/prismalens/commit/a1d4f6ef815ab8733f764931f6bb675de5eb3d5c))
* [#673](https://github.com/prismalens/prismalens/issues/673) walk 8 packet 3 (w8-19..w8-22) and [#834](https://github.com/prismalens/prismalens/issues/834) review ([951afac](https://github.com/prismalens/prismalens/commit/951aface0200e8d5d99f17a103ed11e759ab0405))
* [#831](https://github.com/prismalens/prismalens/issues/831) desktop notification, boot-pull counter, gate script isolation, doctor sign-in ([e1b73ef](https://github.com/prismalens/prismalens/commit/e1b73ef08ff742bc204a52501eea2607b565a6aa))
* [#834](https://github.com/prismalens/prismalens/issues/834) review round 3: scoped check, at-or wording, manual steps, mode switch ([2aa4fb8](https://github.com/prismalens/prismalens/commit/2aa4fb82fffd18ee38fc47c2386c375ed574c499))
* **#786:** CodeRabbit round - attachment bytes, continued-run model and restore, composer keeps text ([abdc68d](https://github.com/prismalens/prismalens/commit/abdc68da3d7236b8c50a594bff52cecdaacaada1))
* **#798:** keep workspace-write as stored; drop a composer mode picked for another agent ([e2ab1c1](https://github.com/prismalens/prismalens/commit/e2ab1c1179e718c52cdf49b642e34dd9b5be3a87))
* **#799:** CodeRabbit round 1 — star click, 1M on agent default, double run, run tree selection ([2b36106](https://github.com/prismalens/prismalens/commit/2b36106a0bdeac881607970d2f0636d992de6f24))
* **#800:** CodeRabbit round 1 — setup line reason, agent mark name, keyboard paths, phone counts ([0cd99fe](https://github.com/prismalens/prismalens/commit/0cd99fe2cbe5744ff59cd3ff34503c5147cd4ec2))
* **#801:** reject an unknown or empty --only check name ([7f6a479](https://github.com/prismalens/prismalens/commit/7f6a479fa959df6312a1dad8ea20354852815486))
* **#802:** CodeRabbit round 1 — sandbox check failure keeps the handshake, serviceless alert scope, draft composer agent ([2dcc16a](https://github.com/prismalens/prismalens/commit/2dcc16ad3fe732b3319b79a024b4dbf426e6659b))
* **#803:** CodeRabbit round 1 — no invented prior end time, --port hint for http :80 only, keep JSON inside error messages, timeline time never truncated, word-bounded write/edit verbs ([9823f9b](https://github.com/prismalens/prismalens/commit/9823f9b334ed47af079bca38d6b444781694044e))
* **#804:** CodeRabbit round 2 — a thrown continue never leaves its row live, result writes take live rows only, draft files survive a remount, proxy drops hop-by-hop headers, the mid-report Stop test waits for the report ([b353a9a](https://github.com/prismalens/prismalens/commit/b353a9a5ed01a6092b986e8c6ecc5f3fb10a55ef))
* **#805:** CodeRabbit round 1 — a refused drop announces the card stayed, a bare-fence cut-off report reads as one line ([b99a28f](https://github.com/prismalens/prismalens/commit/b99a28fa808bea0918bf7fa0608498c0cfb9f205))
* **#805:** CodeRabbit round 2 — dependents before the limit, distinct model versions, readiness before acknowledge, every fence checked for a cut report, delete waits for topology ([e41a8d7](https://github.com/prismalens/prismalens/commit/e41a8d7805f46c61c9bc4235c63da08001645959))
* **#808:** CodeRabbit round 1 — ask CONFLICT vs retryable error, newer-run line without a pinned workspace ([a2c7405](https://github.com/prismalens/prismalens/commit/a2c74056e15d6d976c10fc908cf63c4f17c83840))
* **#809:** CodeRabbit round 1 — OpenCode levels keep the user's own rules, Auto falls back, notes are operator guidance ([e9955b4](https://github.com/prismalens/prismalens/commit/e9955b40ac6e6fc5cf2f9acb91dfd8779bb211ad))
* **#809:** OpenCode webfetch and websearch take one action, not a pattern map ([21e4eb1](https://github.com/prismalens/prismalens/commit/21e4eb160f977092feb7eb95c236ed08fcd123bf))
* **#810:** CI — hermetic follow-up and git-probe specs, typed repository mock ([f7e1f83](https://github.com/prismalens/prismalens/commit/f7e1f8376828fae815f03f7332bb485dec25a680))
* **#810:** CodeRabbit round 1 — rebuilt workspace lands on delivery, git children drop repo-local vars, one mirror op per path ([31cf1a1](https://github.com/prismalens/prismalens/commit/31cf1a1bdf9688c5bd537d28cb72662dcc698d18))
* **#813:** CodeRabbit round 1: unquoted git paths, /graph in the path, lenient option extras ([72e4ef7](https://github.com/prismalens/prismalens/commit/72e4ef7a7aeb12c151868d3e16ebcc51e436353c))
* **#813:** strip git's -z framing once, so a path may start with a newline ([1766277](https://github.com/prismalens/prismalens/commit/1766277dff42d8e466bb691bc7c726eed5f95a94))
* **#814:** CodeRabbit round 1 — Ask naming, delegation results, roving tab stop, recheck without a session, strip Stop toast ([245b76a](https://github.com/prismalens/prismalens/commit/245b76adc7794baacbd120b79d907eb499811258))
* **#815:** CodeRabbit round 1 — check value in the metric's unit, incremental chart peak, connect prompt only when unconfigured ([ed2b0a6](https://github.com/prismalens/prismalens/commit/ed2b0a627ff81dd9655c15348e08fb39045e4ea7))
* **#820:** adversary round 2: MCP input always shown, streamed input fills its step, asks and lines settle on every end ([546d151](https://github.com/prismalens/prismalens/commit/546d1510238d6b3a545ff45948c903bdc1a7d945))
* **#820:** boot answers asks left open on any live run, not only rows still marked waiting ([3187a04](https://github.com/prismalens/prismalens/commit/3187a044f25e11998d97894162dab1b2c4e9e81e))
* **#820:** steps follow ACP status, asks carry their call and input, queued messages are events ([d3b3f71](https://github.com/prismalens/prismalens/commit/d3b3f71298d2d036e6088b8ad6f81d34c2e12ba3))
* **#820:** the overview says a run waits for your approval; a file ask keeps its verb ([c4dabf3](https://github.com/prismalens/prismalens/commit/c4dabf3bdafcf5102b6ae62796a45bb6374db3b6))
* **#822:** CodeRabbit round 1 — a failed rules API is unknown, not a gap; a service claim only wins a still-waiting incident ([e76f01f](https://github.com/prismalens/prismalens/commit/e76f01fb11c21f98bac61efb0d96da637bf70bc0))
* **#822:** CodeRabbit round 2 — an undecided catch-up episode holds the cursor; a service claim skips an incident closed since the read ([bec8453](https://github.com/prismalens/prismalens/commit/bec84531bebc024307196147828c5802acd56d80))
* 0.5.1 first-run polish: README, doctor sign-in, notices, and [#831](https://github.com/prismalens/prismalens/issues/831) fixes ([a004db3](https://github.com/prismalens/prismalens/commit/a004db320af89509cf154b4ef02bf1deabc2042c))
* a flap refire reopens its resolved incident, and an env-supplied model is never reported as substituted ([#741](https://github.com/prismalens/prismalens/issues/741)) ([8769049](https://github.com/prismalens/prismalens/commit/87690499865914fbf6b165a8ce96c2326f84fa48))
* a follow-up on an alert-started run takes your level; the run records it ran unattended ([#818](https://github.com/prismalens/prismalens/issues/818)) ([13c2c7a](https://github.com/prismalens/prismalens/commit/13c2c7a80b1e6a293fff9dd3021ed91fe47f82d1))
* a run PrismaLens starts on its own defaults to Auto ([#673](https://github.com/prismalens/prismalens/issues/673)) ([159beca](https://github.com/prismalens/prismalens/commit/159beca7c4eedeee56ee67ffd46b9bd80bf021e7))
* **admission:** remove the R6 run dir even when setup throws ([3456572](https://github.com/prismalens/prismalens/commit/3456572b79f6a44824c2ca83a3fdbdc8096e55f4))
* **alerts,engine:** two services in one grouped delivery stay two incidents; host facts stay inferred ([#633](https://github.com/prismalens/prismalens/issues/633)) ([#706](https://github.com/prismalens/prismalens/issues/706)) ([2283839](https://github.com/prismalens/prismalens/commit/22838392567fb1ef97d461982c060078a085dd77))
* **alerts:** a refire inside 24 h reopens the incident and starts a run ([#673](https://github.com/prismalens/prismalens/issues/673) w25, w43) ([68ceff2](https://github.com/prismalens/prismalens/commit/68ceff219abf17c860820d562c2a9c177ef81e9b))
* **alerts:** connecting an Alertmanager lists it at once (walk f17) ([9d19bf4](https://github.com/prismalens/prismalens/commit/9d19bf48fa1db646f7b81053e388f834a097c9b7))
* **alerts:** one automatic reopen run per incident per hour ([#673](https://github.com/prismalens/prismalens/issues/673) w25) ([b84e2c6](https://github.com/prismalens/prismalens/commit/b84e2c68d19ed2c26338273ddfefcd13ceeea937))
* an added model reaches Claude Code as its custom model option, then over set_config_option ([#673](https://github.com/prismalens/prismalens/issues/673) w57) ([e82ba1a](https://github.com/prismalens/prismalens/commit/e82ba1a8829bb31610de29ecff3063332b86593d))
* an alert-started run's refusal is its own outcome, never "You denied it" ([#818](https://github.com/prismalens/prismalens/issues/818)) ([1f9ff24](https://github.com/prismalens/prismalens/commit/1f9ff24a63b34f9ed9c8af4a407e51b4021facbe))
* **api:** a restore failure never cancels a follow-up; settled rows' jobs follow them at boot; the receiving turn checks a message's kind ([#804](https://github.com/prismalens/prismalens/issues/804) OBJ-031, OBJ-027, OBJ-032) ([0c5a66b](https://github.com/prismalens/prismalens/commit/0c5a66b6866834830d16610d0ab4e411bd0dba11))
* **api:** a thrown settlement is not applied; a stale Stop never ends a finished run; the job follows a stopped row at boot ([#804](https://github.com/prismalens/prismalens/issues/804) OBJ-024..027) ([15a1f0d](https://github.com/prismalens/prismalens/commit/15a1f0db3867b8b4c71940420ac7a9bc930f4052))
* **api:** reading a run is not rate limited, starting or steering one still is ([4557ed7](https://github.com/prismalens/prismalens/commit/4557ed7dba0d999c91b309125bf874b9e13e1ea7))
* **ci,#818:** harness admission builds the adapter package config imports; regenerate openapi.json ([fe3271d](https://github.com/prismalens/prismalens/commit/fe3271dcb83a3d38dfe4538aa122f2be5f684729))
* **ci:** four flakes at their cause, and parallel e2e with one stack per worker ([5545324](https://github.com/prismalens/prismalens/commit/55453241c8273fa3459102475d9116111303d40c))
* **ci:** keep the app-boot smoke's event loop free while sampling processes ([e4e08ce](https://github.com/prismalens/prismalens/commit/e4e08cedc9ea1a73beb8ec446562bdaf5c2ccfd9))
* **ci:** retry a reset connection in the app-boot smoke script ([#772](https://github.com/prismalens/prismalens/issues/772)) ([4a7f8cc](https://github.com/prismalens/prismalens/commit/4a7f8ccd8297db47729c02d6befdeffcdb2b6b13))
* clear CodeRabbit review on [#797](https://github.com/prismalens/prismalens/issues/797) ([0ac586d](https://github.com/prismalens/prismalens/commit/0ac586d4d5b9ef67be7262f7a572c9156e830aa8))
* **cli,docs:** what a stranger hits first in 0.5.1 ([f34ab6e](https://github.com/prismalens/prismalens/commit/f34ab6ea883b85a1e61202fd796d8dc3a927937b))
* **cli:** a failed upgrade trial's reason is one redacted line plus the log path ([9ee09a2](https://github.com/prismalens/prismalens/commit/9ee09a22e651cdfc338c0a59a9c34040cea7dee7))
* **cli:** avoid Array.findLast, outside the CLI's ES lib ([ccb5495](https://github.com/prismalens/prismalens/commit/ccb54951b47741f14ca3f259b6e7870cf52c6efd))
* **cli:** no clock time on every terminal line ([a547b71](https://github.com/prismalens/prismalens/commit/a547b71125f55dda8b31eb2b1a49b282ef8d03a8))
* **cli:** one clean terminal line for a network bind; detail stays in the log ([71856f3](https://github.com/prismalens/prismalens/commit/71856f385ad3ff38a163e079492765634ec6b179))
* **cli:** open the browser under WSL through PowerShell, not cmd.exe ([d34d3bd](https://github.com/prismalens/prismalens/commit/d34d3bd14a890f84e2d097809c113e82e8678d0a))
* **cli:** open the browser under WSL without Windows on PATH, and say when it didn't ([#673](https://github.com/prismalens/prismalens/issues/673) w3) ([fbd1f81](https://github.com/prismalens/prismalens/commit/fbd1f8172708e04a34b058a931f336b6e876dc71))
* **cli:** pl pair --tailscale pairs when this machine can't resolve the tailnet name ([e172484](https://github.com/prismalens/prismalens/commit/e172484ff9dbe3324b5612f4662ae7f52ee73912))
* **cli:** pl service tells no-systemd from no-user-manager, and shows restarting ([2f839e3](https://github.com/prismalens/prismalens/commit/2f839e31ba4c30aa728f377be115be5b93ecd288))
* **cli:** pl up says when a device pairs, a taken port in one line, secrets in the info style ([#673](https://github.com/prismalens/prismalens/issues/673) w55) ([6dffd0c](https://github.com/prismalens/prismalens/commit/6dffd0c7169c958e563245ca64d6aaf52d32c249))
* **cli:** pl upgrade trials the background service whatever workspace it serves ([#673](https://github.com/prismalens/prismalens/issues/673) w54) ([5633b7a](https://github.com/prismalens/prismalens/commit/5633b7ae9a671a959b7e0c5bff781de1bce8e610))
* **cli:** the consent line no longer calls usage events anonymous ([#731](https://github.com/prismalens/prismalens/issues/731)) ([f4fc7e2](https://github.com/prismalens/prismalens/commit/f4fc7e2bdf6ef8917e936e60db968e26c41022ff))
* **cli:** WSL browser open, tailscale pair preflight, service diagnostics, rollback reason ([#673](https://github.com/prismalens/prismalens/issues/673) walk) ([8960b29](https://github.com/prismalens/prismalens/commit/8960b296f39857649a4903ca72f5485572706099))
* **database:** better-sqlite3 13 prebuilds so npm 12 installs need no script ([8234a40](https://github.com/prismalens/prismalens/commit/8234a40eeb02c29c05fe845936c4c8da2ffb1f1d))
* **database:** better-sqlite3 13 prebuilds so npm 12 installs need no script ([21ff113](https://github.com/prismalens/prismalens/commit/21ff113a2e1b2e959498a5c072ed9e9aae4a1f90))
* **deps:** override patched proxy-addr, qs, multer, shell-quote, source-map-js, mysql2 ([50d999d](https://github.com/prismalens/prismalens/commit/50d999d208f90a945cbeb00729f2e7095d216bb7))
* **deps:** override patched transitive deps for 13 Dependabot alerts ([d071452](https://github.com/prismalens/prismalens/commit/d0714525ee960fc8a7cc0ffac2cfc78a52f18743))
* **desktop:** publish as PrismaLens at the release version; Reset leaves the tray ([#819](https://github.com/prismalens/prismalens/issues/819)) ([676f929](https://github.com/prismalens/prismalens/commit/676f929f184c8b2bc889a9d559fb0992b788e95d))
* **desktop:** quitting stops the backend over IPC so it releases the workspace lock ([#819](https://github.com/prismalens/prismalens/issues/819)) ([43311b4](https://github.com/prismalens/prismalens/commit/43311b4e223ba9698e5955ff1b1a71dde37de82d))
* **desktop:** rebuild better-sqlite3 for Electron when no prebuilt exists ([533230c](https://github.com/prismalens/prismalens/commit/533230ce4917f2a004a2d70db7cdd58687402402))
* **desktop:** ship the bundled server as one asar, not 23k loose files ([#673](https://github.com/prismalens/prismalens/issues/673) w53) ([12041e5](https://github.com/prismalens/prismalens/commit/12041e5d1aa7f40b53eae6ab06aae6e804eaed05))
* **desktop:** title row, PrismaLens publisher, no tray reset, quit releases the lock ([#673](https://github.com/prismalens/prismalens/issues/673) walk 5, L4) ([acee174](https://github.com/prismalens/prismalens/commit/acee174ed3c6f310b467b70888dcbeb3603da7d2))
* **dev:** exclude cli's one-shot bin from turbo run dev ([bae22e5](https://github.com/prismalens/prismalens/commit/bae22e5e91c863d1f684830dac46417f91f601cd))
* **dev:** exclude the cli's one-shot bin from turbo run dev ([be36636](https://github.com/prismalens/prismalens/commit/be36636a44190d41e8af78013199217d414872e7))
* **dev:** pair only loopback browsers; address [#787](https://github.com/prismalens/prismalens/issues/787) review ([6dda50d](https://github.com/prismalens/prismalens/commit/6dda50d9d4bc965bbae332303c94b42a632fc21a))
* **dev:** pair the dev browser and the desktop window automatically ([f384c8d](https://github.com/prismalens/prismalens/commit/f384c8d8887bf2d7f38805506693f9f951871626))
* **dev:** pair the dev browser and the desktop window automatically ([499dc04](https://github.com/prismalens/prismalens/commit/499dc04e50e40df58b00d0e350fd03d9143eadf6))
* **engine,frontend:** Stop during the report retry ends as a stop; report failures read plainly ([#673](https://github.com/prismalens/prismalens/issues/673) w34) ([8738c13](https://github.com/prismalens/prismalens/commit/8738c13f63affe42a5461d452ed4ab2bf4bebcfa))
* **engine:** a stop during harness startup never sends the prompt ([#743](https://github.com/prismalens/prismalens/issues/743)) ([fac519b](https://github.com/prismalens/prismalens/commit/fac519b8371580f7874bf024057ff54b09aaa1ca))
* **engine:** a swapped-in binary runs as given, never the shipped adapter ([#818](https://github.com/prismalens/prismalens/issues/818)) ([a26d236](https://github.com/prismalens/prismalens/commit/a26d236981f68316f72cb3d9d77c20fb9db5a42c))
* **engine:** access levels and an honest read-only guardrail, tested against a red-team corpus ([#778](https://github.com/prismalens/prismalens/issues/778)) ([ca53c86](https://github.com/prismalens/prismalens/commit/ca53c86b8a684e3a733a148da307ce9eee5102f2))
* **engine:** latch a session/cancel the fake agent receives before its turn waits ([#809](https://github.com/prismalens/prismalens/issues/809)) ([394917c](https://github.com/prismalens/prismalens/commit/394917c05f391c406825cab7e3d96baeb7086de7))
* **engine:** Send now carries the queued messages ahead of it, in order ([#673](https://github.com/prismalens/prismalens/issues/673) w33) ([f913553](https://github.com/prismalens/prismalens/commit/f913553e3acebc75c3ad93590ac931d88b3c9aa9))
* **engine:** the admission script runs at Auto, as an unattended run does ([#673](https://github.com/prismalens/prismalens/issues/673)) ([edd2ea8](https://github.com/prismalens/prismalens/commit/edd2ea839382deae9babda74327cce8a26acf823))
* **engine:** the deadline kills the harness's process group, and shutdown reaps it ([#693](https://github.com/prismalens/prismalens/issues/693)) ([843f349](https://github.com/prismalens/prismalens/commit/843f3491905060c5c23e661c529655b9e1103834))
* **engine:** the permission policy judges the real path, not the lexical one ([#685](https://github.com/prismalens/prismalens/issues/685)) ([ddaa8d0](https://github.com/prismalens/prismalens/commit/ddaa8d0f3aa662a044e555d6348cb168b50459d3))
* **frontend:** a cleared alert's dot is quiet on the Alerts tab and the alert page, not severity red ([#673](https://github.com/prismalens/prismalens/issues/673) w24) ([d6a29ea](https://github.com/prismalens/prismalens/commit/d6a29ea6bf70c9b59ac9cc9b7a2d11b395d00c06))
* **frontend:** a cleared alert's header says when it cleared, not when it fired ([#673](https://github.com/prismalens/prismalens/issues/673) walk 4) ([ff0fc5c](https://github.com/prismalens/prismalens/commit/ff0fc5c6843163d8704b0c299df1ae14bc9b55c7))
* **frontend:** a Do now tick travels on the incident's topic; the summary reads the selected run ([c6b9b9f](https://github.com/prismalens/prismalens/commit/c6b9b9f73e7c06006c58ee8aeab0f56993ae72cc))
* **frontend:** a drop on Concluded stops any live run, without asking ([#673](https://github.com/prismalens/prismalens/issues/673) walk 4) ([b9cb619](https://github.com/prismalens/prismalens/commit/b9cb6193ea6e65110955e74de5df9460a707960c))
* **frontend:** a drop on Working acknowledges the incident and starts its run ([#673](https://github.com/prismalens/prismalens/issues/673) walk 4) ([ee13a4d](https://github.com/prismalens/prismalens/commit/ee13a4dc38b4e1d47d2618e2bc4e0efaa2b97e9c))
* **frontend:** a follow-up's first message marks its boundary, so a dropped Stop event never hides an Ask's error ([#804](https://github.com/prismalens/prismalens/issues/804) OBJ-028) ([b23601e](https://github.com/prismalens/prismalens/commit/b23601e5644b1e483bf3032b15a8f28c54154df5))
* **frontend:** a labelled Back heads each phone settings section ([1dfddbc](https://github.com/prismalens/prismalens/commit/1dfddbcb0f947cb2d68c41e17c0a818f9f604d75))
* **frontend:** a list row stays lit only while the pointer or the keyboard cursor is on it ([#738](https://github.com/prismalens/prismalens/issues/738)) ([#739](https://github.com/prismalens/prismalens/issues/739)) ([59ebec9](https://github.com/prismalens/prismalens/commit/59ebec9f54084ba947bd10741b4209b11766b7c2))
* **frontend:** a loaded screen keeps what it has when the server stops answering ([7cd2fe1](https://github.com/prismalens/prismalens/commit/7cd2fe16b233659c1cfd500235bb1b7581fc4876))
* **frontend:** a queued message carried by Send now reads "Sent now" ([#673](https://github.com/prismalens/prismalens/issues/673) walk 4) ([81a8d10](https://github.com/prismalens/prismalens/commit/81a8d102a495fd825ffda481fde87cab4cbc0fba))
* **frontend:** a report cut off by a mid-turn message reads as one line, not raw JSON ([#673](https://github.com/prismalens/prismalens/issues/673) walk 4) ([4ce4f83](https://github.com/prismalens/prismalens/commit/4ce4f837bb9f571a7758cfece152771e588273fd))
* **frontend:** a resolved incident's Overview stops asking the operator to resolve it ([#673](https://github.com/prismalens/prismalens/issues/673) walk 4) ([047bfba](https://github.com/prismalens/prismalens/commit/047bfba235f260c7ec415a5782cb94e2e51b8ca9))
* **frontend:** a resumed run's timer counts the current turn, not the hours since the run began ([#673](https://github.com/prismalens/prismalens/issues/673) walk 4) ([0eb9369](https://github.com/prismalens/prismalens/commit/0eb936905cd7975e6117bc4941338695ce297e43))
* **frontend:** a stopped run's unanswered tool calls read "not finished", not "running" ([#673](https://github.com/prismalens/prismalens/issues/673) walk 4) ([946fb1e](https://github.com/prismalens/prismalens/commit/946fb1e35aaa928938a4e9da370425f11c0f1673))
* **frontend:** Add a service from the setup line keeps its dialog ([b595842](https://github.com/prismalens/prismalens/commit/b595842346bc9122bdc16852eafb871867b4ca20))
* **frontend:** Add service keeps its field ids and Create service ([88449d6](https://github.com/prismalens/prismalens/commit/88449d6379154b69a4cc39b3d7f88043c1549492))
* **frontend:** address [#789](https://github.com/prismalens/prismalens/issues/789) review ([1f5f3ef](https://github.com/prismalens/prismalens/commit/1f5f3ef3b195f280b09570ef933d8fefcf182267))
* **frontend:** an Ask on a stopped run reads "Asked", not "Continued the run" ([#673](https://github.com/prismalens/prismalens/issues/673) walk 4) ([33007a9](https://github.com/prismalens/prismalens/commit/33007a9c3a2e7a237cc0e7fe0bd076a7b9a33b8f))
* **frontend:** an Ask that errored on a stopped run says so, under the Ask, even with its events dropped ([#804](https://github.com/prismalens/prismalens/issues/804) OBJ-028) ([b7e74b1](https://github.com/prismalens/prismalens/commit/b7e74b1a288c50d482297c976b18547bcfe07c42))
* **frontend:** D1 visual pass against ux-v2, and what the e2e run caught ([#673](https://github.com/prismalens/prismalens/issues/673)) ([f958b60](https://github.com/prismalens/prismalens/commit/f958b60be5968a506e1e35c2a43ca3ee60de9b91))
* **frontend:** dark --shadow-raised composes in shadow lists ([951fd2a](https://github.com/prismalens/prismalens/commit/951fd2ace9be693188d864ee75b9bc2cc75cccac))
* **frontend:** keep the last board and alert list through a failed refetch ([d373c66](https://github.com/prismalens/prismalens/commit/d373c669840c5b4de7aaa1b76f65b3893e2a158c))
* **frontend:** number runs among investigations, Ask words, mono step command ([#811](https://github.com/prismalens/prismalens/issues/811)) ([8b48b45](https://github.com/prismalens/prismalens/commit/8b48b45277747a383cfbb2daefeb683046c8ecf4))
* **frontend:** old investigation links redirect; active run age reads in text-2 ([#811](https://github.com/prismalens/prismalens/issues/811)) ([8a07cee](https://github.com/prismalens/prismalens/commit/8a07cee2934a1a5b63b64c319d387a5a0161041f))
* **frontend:** old run links reach the run; Esc goes to the inbox ([#811](https://github.com/prismalens/prismalens/issues/811), [#815](https://github.com/prismalens/prismalens/issues/815)) ([6d25fba](https://github.com/prismalens/prismalens/commit/6d25fba16ce6c6e8960c8421119e9d21bc7cc665))
* **frontend:** overview Connect Prometheus, fix-check strip and Resolved refire link ([#815](https://github.com/prismalens/prismalens/issues/815)) ([1ee513d](https://github.com/prismalens/prismalens/commit/1ee513db71fbc0a7e5208bfecfe0a681a084bbbd))
* **frontend:** Resolve counts the cause against its limit and says when it is too long ([#673](https://github.com/prismalens/prismalens/issues/673) walk 4) ([1b8af9a](https://github.com/prismalens/prismalens/commit/1b8af9a8d660409710df3617eae3ec4a48d48ea1))
* **frontend:** scrollbars are thin and tonal, not the browser's default ([#673](https://github.com/prismalens/prismalens/issues/673) walk 4) ([7c738a8](https://github.com/prismalens/prismalens/commit/7c738a8c3411bce841b3ebd1fc843a4fc71dd735))
* **frontend:** settings column left-aligned, harness error and spec copy ([f702019](https://github.com/prismalens/prismalens/commit/f7020192c69475ae62f504ab23e969494f17a796))
* **frontend:** sidebar contrast, inbox Resolve stops the live turn, arrival glow per batch ([#811](https://github.com/prismalens/prismalens/issues/811)) ([63d8f1d](https://github.com/prismalens/prismalens/commit/63d8f1d7b73a3d3aa11263bf56e5389f08bd6800))
* **frontend:** sidebar tree stops cancelling the old-run redirect; live arrival filters to its row ([#811](https://github.com/prismalens/prismalens/issues/811)) ([10807c2](https://github.com/prismalens/prismalens/commit/10807c2b3ab46ad8690853786336a574f379fd72))
* **frontend:** the agent picker wraps long model names, drops the repeated provider prefix and names a model one way ([#673](https://github.com/prismalens/prismalens/issues/673) f7) ([662fc8e](https://github.com/prismalens/prismalens/commit/662fc8eedbb080d9d0432dc3a18f3ccae035af08))
* **frontend:** the board's keyboard drag carries a card a column at a time and says what a drop does ([#673](https://github.com/prismalens/prismalens/issues/673) walk 4) ([ff1c863](https://github.com/prismalens/prismalens/commit/ff1c86318fbabc362465ddce1605a85c18fd9626))
* **frontend:** the box waits for the selected run, so typed text survives its load ([f447154](https://github.com/prismalens/prismalens/commit/f447154f705c9f7caee8892a88375e782299ca2f))
* **frontend:** the composer's chips wrap on a narrow window instead of clipping the mode chip ([#673](https://github.com/prismalens/prismalens/issues/673) walk 4) ([e1e172f](https://github.com/prismalens/prismalens/commit/e1e172f4ddc4a56ad84b3ab59ed47f1f0423c6f3))
* **frontend:** the delete-service dialog names the dependency links that go with the service ([#673](https://github.com/prismalens/prismalens/issues/673) walk 4) ([0d9aa3e](https://github.com/prismalens/prismalens/commit/0d9aa3e31940a5f54f2484d7077701de4e6837e4))
* **frontend:** the dev proxy drops the change stream when the API dies ([1ad0ce4](https://github.com/prismalens/prismalens/commit/1ad0ce46a39b9e7adbc437c252393ce720152a38))
* **frontend:** the incident's Timeline refreshes after Acknowledge, Resolve and Reopen ([#673](https://github.com/prismalens/prismalens/issues/673) walk 4) ([90a809e](https://github.com/prismalens/prismalens/commit/90a809e2f94b4a2e63fb814331dab7a7b6a3c811))
* **frontend:** the overflow cue gets a row of its own under each card body ([#811](https://github.com/prismalens/prismalens/issues/811)) ([9544cff](https://github.com/prismalens/prismalens/commit/9544cff3bb67a60bfe60fc0f9334c092ce174468))
* **frontend:** the Overview summary floors an incident's age the way the header does ([#673](https://github.com/prismalens/prismalens/issues/673) walk 4) ([e76bde9](https://github.com/prismalens/prismalens/commit/e76bde93854608e27ebeae697aac8439fcad8058))
* **frontend:** the phone strip keeps its doors on Settings (L65) ([11372ae](https://github.com/prismalens/prismalens/commit/11372aeea1c508f86f7ee6147fe31fee92a5b17f))
* **frontend:** the phone strip keeps its doors on Settings (L65) ([d19e590](https://github.com/prismalens/prismalens/commit/d19e590e8d54ec8a6ef41310ee2916a432980222))
* **frontend:** the picker keeps its 380 by 400 panel; names wrap inside it ([#673](https://github.com/prismalens/prismalens/issues/673) walk 4) ([43bba48](https://github.com/prismalens/prismalens/commit/43bba48125c26be2f1df6543cb80e407b5df9b43))
* **frontend:** the prose test id wraps the agent's words, not its name ([eb65e04](https://github.com/prismalens/prismalens/commit/eb65e04a3c7c8b340785e8e55bac64e3b8b729c6))
* **frontend:** the record waits for its run before saying there is none ([c36f72e](https://github.com/prismalens/prismalens/commit/c36f72e6140155245dfc9c999648d26ea449ea39))
* **frontend:** the Reopen dialog says the incident goes back to open and its cause is kept ([#673](https://github.com/prismalens/prismalens/issues/673) walk 4) ([bf2b8c5](https://github.com/prismalens/prismalens/commit/bf2b8c59218b94db29b55545bc4e17cff775f08a))
* **frontend:** the Report's alert cell says Cleared when the alert cleared after the report ([#673](https://github.com/prismalens/prismalens/issues/673) walk 4) ([ea00aa1](https://github.com/prismalens/prismalens/commit/ea00aa1f611c571a2662730e7d4a68215ec96bb4))
* **frontend:** the Safari scrollbar thumb is 6 px wide instead of an 8 px one inset by a transparent border ([#673](https://github.com/prismalens/prismalens/issues/673) walk 4) ([df7093e](https://github.com/prismalens/prismalens/commit/df7093ea5bd3b8c7643299f9d44ac7d849a348a4))
* **frontend:** the yes clause on every mode in which the agent can ask ([#673](https://github.com/prismalens/prismalens/issues/673) w21) ([2cfd9a2](https://github.com/prismalens/prismalens/commit/2cfd9a2e59c4bc2d0c3a6ed68167a5036dd4b4d5))
* **frontend:** Timeline status entries use the band's words, not the stored status names ([#673](https://github.com/prismalens/prismalens/issues/673) walk 4) ([100e9b6](https://github.com/prismalens/prismalens/commit/100e9b6838875ecfdc383fdbdc2ec841baee2d0c))
* **frontend:** tool groups say what a call did; a run's first message started it ([#673](https://github.com/prismalens/prismalens/issues/673)) ([777e6cb](https://github.com/prismalens/prismalens/commit/777e6cb8d301f25f585379403d68eb6b73c78b22))
* **frontend:** unlisted Do-now steps sort last; accent text on the nav trigger ([068b87e](https://github.com/prismalens/prismalens/commit/068b87e587f689b19af07b68b43364bce61b3b05))
* **frontend:** walk-6 release blockers for 0.5.1 ([#673](https://github.com/prismalens/prismalens/issues/673)) ([83ce2d3](https://github.com/prismalens/prismalens/commit/83ce2d3928ec3af6bd53516ae77fa8d94795eec3))
* **frontend:** walk-6 release blockers for 0.5.1 ([#673](https://github.com/prismalens/prismalens/issues/673)) ([d94948c](https://github.com/prismalens/prismalens/commit/d94948c8cb65d747e2f347c8a900fcb64a6c4cac))
* **frontend:** Working says where a live run is when its card waits in Needs you ([#673](https://github.com/prismalens/prismalens/issues/673) walk 4) ([ac3c608](https://github.com/prismalens/prismalens/commit/ac3c6081eca187f4a38dcee4efc214684da10d50))
* **harness:** readiness is checked before a run starts; checks run per row ([#673](https://github.com/prismalens/prismalens/issues/673) w9, w17, w8) ([7207968](https://github.com/prismalens/prismalens/commit/7207968a15b3610ec8b779d6ec4ca385f78b1a50))
* **harness:** under WSL a Windows agent shim is the Windows install, never probed ([#673](https://github.com/prismalens/prismalens/issues/673) w8) ([67e52cc](https://github.com/prismalens/prismalens/commit/67e52ccde42fb302311ca445c28f9486802ce7ec))
* **incidents:** one name per end state, linked merges, an honest catch-up, late services ([#822](https://github.com/prismalens/prismalens/issues/822)) ([b15fe0e](https://github.com/prismalens/prismalens/commit/b15fe0e13ebf5eb3090850e1c23c191139305ff6))
* **incidents:** one name per end state, linked merges, an honest catch-up, late services ([#822](https://github.com/prismalens/prismalens/issues/822)) ([9d478db](https://github.com/prismalens/prismalens/commit/9d478dbca48a0f21043c1fc5aca9da5b9a44fb01))
* **investigations:** a run never moves the incident's status ([#673](https://github.com/prismalens/prismalens/issues/673) w19, w20) ([5eabc4b](https://github.com/prismalens/prismalens/commit/5eabc4bf9e32488c9a76fb16beaf298d68eca9a1))
* **opencode:** honour the user's own OpenCode config; drop the prismalens agent ([5ac0e06](https://github.com/prismalens/prismalens/commit/5ac0e06168148844db7adc614f055e6012416d22))
* **opencode:** run on the user's own model; overlay owns the run's agent ([24aed52](https://github.com/prismalens/prismalens/commit/24aed52abf0685c53d9b7524d8fcffe955187bb2))
* **opencode:** run on the user's own OpenCode config ([60068b2](https://github.com/prismalens/prismalens/commit/60068b2d1920a32931a66cfef2e01fe8196ac0f7))
* **overlay:** similar past incidents are ended ones, never a service-only match ([#673](https://github.com/prismalens/prismalens/issues/673) w40) ([7a84f20](https://github.com/prismalens/prismalens/commit/7a84f20ebdc5b3ce2fce227fc90ce3e086a38233))
* **pack:** stop shipping better-auth, which nothing imports ([#673](https://github.com/prismalens/prismalens/issues/673) w1) ([cd4d015](https://github.com/prismalens/prismalens/commit/cd4d0153ce6bc59ec0d2dcc63e1926605f35d11a))
* **pair:** point other devices at Tailscale, not a LAN IP ([#774](https://github.com/prismalens/prismalens/issues/774)) ([e25dcef](https://github.com/prismalens/prismalens/commit/e25dcef1b08d55b65c4b3ddc0096777c746dc686))
* **record:** Report falls back to the newest run when none left a report ([#673](https://github.com/prismalens/prismalens/issues/673)) ([409f464](https://github.com/prismalens/prismalens/commit/409f464f7695aafc3a17ba42597240ed47a058af))
* refire timeline line shows a readable time; the culprit line ends with one full stop ([#673](https://github.com/prismalens/prismalens/issues/673)) ([de69325](https://github.com/prismalens/prismalens/commit/de69325deb2b601d091d318b9cc5eba75c572e4b))
* **report:** the Markdown export carries the recorded actual cause ([#673](https://github.com/prismalens/prismalens/issues/673) w41) ([736144f](https://github.com/prismalens/prismalens/commit/736144f41f4c8497ec91184518ae3e502b1bfce9))
* **report:** the report and its Markdown export name no agent or model ([#673](https://github.com/prismalens/prismalens/issues/673) w58) ([943e7b8](https://github.com/prismalens/prismalens/commit/943e7b8183b355d7eb731a272a12650c511a59a7))
* run page asks open in a dock on the box; steps once; waiting and queued state survive reloads ([#820](https://github.com/prismalens/prismalens/issues/820)) ([d7a3d79](https://github.com/prismalens/prismalens/commit/d7a3d7956e65d5d89a89dcafdeeca0daf0163e50))
* **runs:** permission is the agent's own mode ([#673](https://github.com/prismalens/prismalens/issues/673) walk w21, w26) ([21451a0](https://github.com/prismalens/prismalens/commit/21451a0ce6127ab170492825dad85fd968ed3ce6))
* **settings:** "tested &lt;version&gt;", a "Default" effort chip, per-kind source fields ([#673](https://github.com/prismalens/prismalens/issues/673) w56) ([d7fed2f](https://github.com/prismalens/prismalens/commit/d7fed2f7f2d06246e020d4d6eb2c1c4f48836ac5))
* SQL keeps LF on every checkout, so Windows builds' migration checksums match the published ones ([#722](https://github.com/prismalens/prismalens/issues/722)) ([9d17e9f](https://github.com/prismalens/prismalens/commit/9d17e9f5ebfc536efeb39b7cd7a790825812ff24))
* the 0.5.1 walk's code defects — alert lifecycle, follow-ups, live updates, agent access, stop and reset ([#776](https://github.com/prismalens/prismalens/issues/776)) ([6929f0e](https://github.com/prismalens/prismalens/commit/6929f0e2bdb7787a1b932acd7962b8a1b9719a07))
* **timeline:** the resolve-by-absence reason shows on the Timeline ([#673](https://github.com/prismalens/prismalens/issues/673) w23) ([2f072c1](https://github.com/prismalens/prismalens/commit/2f072c199695743f054c563a3fb3dc5be7613901))
* **turbo:** pass the workspace dir and DB URL through to db:migrate, db:studio, db:reset ([9670177](https://github.com/prismalens/prismalens/commit/96701776560ff27251f2083f43eef22318b47475))
* **ui:** [#673](https://github.com/prismalens/prismalens/issues/673) walk 9 findings (w9-1..w9-4) ([c6d075d](https://github.com/prismalens/prismalens/commit/c6d075ded7b4a1316377d294c8ac215e80b2fa2d))
* **ui:** [#831](https://github.com/prismalens/prismalens/issues/831) small fixes from walks 6 and 7 ([cfa4b09](https://github.com/prismalens/prismalens/commit/cfa4b09b5b0cf0089f90a8f9652f3966122109a4))
* walk 3 findings ([#673](https://github.com/prismalens/prismalens/issues/673)) ([ded7f33](https://github.com/prismalens/prismalens/commit/ded7f33ec2bf554eab80f96006984b6afced8fb4))
* walk 4 findings ([#673](https://github.com/prismalens/prismalens/issues/673)) ([4801c61](https://github.com/prismalens/prismalens/commit/4801c613f31a2a25d18d30020c2a26baf6b75fec))
* walk leftovers — webhook alerts resolve by absence once their Alertmanager is connected, host device test ([9b7dd9b](https://github.com/prismalens/prismalens/commit/9b7dd9b4d32d36f1d92938b45f655dc10f13d1ec))

## [0.5.0](https://github.com/prismalens/prismalens/compare/prismalens@0.5.0-rc.3...v0.5.0) (2026-09-19)


### ⚠ BREAKING CHANGES

* harden the 0.5.0 run (U12): refuse fetch, isolate harness config, reap snapshots, no install beacon ([#643](https://github.com/prismalens/prismalens/issues/643))
* trust floor, harness readiness probe and per-run repo snapshot (U6, U7, U8) ([#640](https://github.com/prismalens/prismalens/issues/640))
* one ACP run per investigation, detect-and-report harness, deferred modules and pre-release lineage removed ([#621](https://github.com/prismalens/prismalens/issues/621))

### Features

* **cli:** pl up prints the log path and the ready URL, harness stderr goes to the logger ([#625](https://github.com/prismalens/prismalens/issues/625)) ([d763f64](https://github.com/prismalens/prismalens/commit/d763f649c4f9640501d40c6e4fbeaa66336887fc))
* trust floor, harness readiness probe and per-run repo snapshot (U6, U7, U8) ([#640](https://github.com/prismalens/prismalens/issues/640)) ([f99406b](https://github.com/prismalens/prismalens/commit/f99406b467f63c761c73b23f47b562da3decbbd1))


### Bug Fixes

* **cli:** pl up runs the packaged app as production ([#652](https://github.com/prismalens/prismalens/issues/652)) ([7fad438](https://github.com/prismalens/prismalens/commit/7fad4386d3f2c120a3f2dba0e66cec6f77799343))
* harden the 0.5.0 run (U12): refuse fetch, isolate harness config, reap snapshots, no install beacon ([#643](https://github.com/prismalens/prismalens/issues/643)) ([54d9a8f](https://github.com/prismalens/prismalens/commit/54d9a8f328401f9bb67876039b1f3a5ce9252be4))
* stranger walk run e gaps G10 to G19: extractor, default model, doctor, stale queries, guardrail, reaping ([#651](https://github.com/prismalens/prismalens/issues/651)) ([65adef5](https://github.com/prismalens/prismalens/commit/65adef5cf7635ace3e695631cc7bd26c3f8b7930))


### Code Refactoring

* one ACP run per investigation, detect-and-report harness, deferred modules and pre-release lineage removed ([#621](https://github.com/prismalens/prismalens/issues/621)) ([d8c6e51](https://github.com/prismalens/prismalens/commit/d8c6e510ead55e58a4f6c04169f7b576bec67ea8))

## 0.5.0-rc.3

### Patch Changes

- 3ef7759: The dashboard banner, incident header, and detail tab now disable the investigate button when an investigation cannot start, displaying the exact reason instead of generic warnings. The banner is retitled "AI Investigations Unavailable" when a configured provider is unusable. (#521)

## 0.4.0

### Minor Changes

- d2ba9f4: prismalens is now the single published package; @prismalens/engine, config and contracts are bundled into the CLI and no longer published separately.

## 0.3.0

### Minor Changes

- 0049fa8: cli/config: normalize key casing and split the
  harness/reduce model knobs (#180, #148 items 8-11).

  - **Config key casing (item 8):** `telemetry` keys are now snake_case
    (`prometheus_url`, `alertmanager_url`, `api_url`) to match every other config key.
    No back-compat aliases (dev phase) — update your `prismalens.config.yaml`.
  - **`agent.model` split (item 11):** `agent.model` now sets the Tier-2 HARNESS model
    only; the Tier-1 reduce model is `synth.model` (ADR-0013/0016). `agent.model` no
    longer falls back into the reduce call, so a harness on one provider can't misroute
    the reduce call to another.

- 4bbb2b1: CLI UX fixes (issue #179): the storage directory is now consistently the "workspace directory" — env var `PRISMALENS_USER_FOLDER` → `PRISMALENS_WORKSPACE_DIR`, config key `workspace.base_dir` → `workspace.dir`, flag `--base-dir` → `--workspace-dir` (renames, no aliases); explicit env-var paths are used verbatim (no `.prismalens` suffix appended); invalid flags print the error + a one-line help hint instead of the full help dump; registry default models refreshed (incl. replacing Groq's `llama-3.3-70b-versatile`, EOL 2026-08-16, with `openai/gpt-oss-120b`).

### Patch Changes

- Updated dependencies [4bbb2b1]
  - @prismalens/config@0.3.0
  - @prismalens/contracts@0.1.1
  - @prismalens/engine@0.2.1

## 0.2.0

### Minor Changes

- 4636c9c: feat: add stored credentials support to CLI (`pl auth login`, `list`, `logout`) (#151)

### Patch Changes

- c824957: CLI UX quick wins: `--json` on `pl status`/`pl report`, unknown flags and config keys now warn/error instead of passing silently, readable config errors, explicit stdin parse errors, SQLite ExperimentalWarning suppressed, usage examples in `--help`.
- 4636c9c: Degrade gracefully on permission errors in auth store; document pl auth.
- bd40a4b: fix(cli): wire --host through startup, expose bound host, token docs (#138)
- bd40a4b: Add `host` config option to `pl listen` and emit a structured log line on accepted webhook intake.
- c824957: Fix json error parity, own-property config check, and remove invalid any casts.
- Updated dependencies [4636c9c]
- Updated dependencies [6bbc048]
- Updated dependencies [4636c9c]
  - @prismalens/config@0.2.0
  - @prismalens/contracts@0.1.0
  - @prismalens/engine@0.2.0

## 0.1.1

### Patch Changes

- 6a137ec: Improves listener resilience by automatically reaping orphaned runs on startup and accurately suppressing duplicate investigations for re-paged alerts.
- e19a42b: Refine DB schema-recovery to only trigger on schema errors (ignoring operational errors), and extend validation to all schema columns.
- e19a42b: Fix issue where starting `pl listen` against a stale workspace DB hard-crashes at startup by automatically backing up the incompatible DB file and creating a fresh store.
- ed8ac21: Fix caps-slot leak on refused dispatch and record refusals in session store.
- Updated dependencies [ed8ac21]
  - @prismalens/engine@0.1.1

## 0.1.0

### Minor Changes

- 3b99bdc: Budget guardrails for `pl listen`, so an alert storm can't fan out into unbounded investigations. Three new `listen` config keys cap dispatch: `max_concurrent` (default 2) and `max_per_hour` (default 10, a rolling 60-minute window) gate whether a group is investigated, and `max_turns` bounds an individual Claude Code run. Over-cap groups are recorded as terminal `suppressed` runs with a suppression reason — visible in `pl status`, filterable with `--status suppressed` — rather than dropped silently. A suppressed run is not retried, since intake has already acknowledged the alert.
- 3b99bdc: `pl status` and `pl report` join the CLI, backed by a new `node:sqlite` record store (#60). Investigation runs, alert groups, events, and reports now persist to a WAL-mode SQLite database in place of the old JSON session files — no new native dependency, since it uses Node's built-in `node:sqlite` (which raises the CLI's Node floor to `>=22.13.0`, checked at startup). `pl status` lists runs and takes an optional `--status` filter; `pl report <id>` prints a stored report, adding the run's event timeline with `--events`. Failed runs now record their error reason instead of dropping it.
- 3b99bdc: `pl listen` now sends a best-effort Slack notification when a group investigation finishes — successful, no-evidence, and errored runs all notify (an errored 3AM run is exactly what you want woken for); operator-cancelled runs don't. Set the single `listen.slack_webhook_url` config field to enable it; leave it unset and nothing is sent. Delivery is fire-and-forget with a 5s timeout and no retries, and a failed post can never change a run's outcome — it emits one structured `slack_delivery_failed` line and nothing more.
- a79f5ef: Credential resolution and CLI safety fixes (#142–#147):

  - Unified credential resolution for all LLM providers per ADR-0024: precedence env → `_FILE` → none; the config file carries provider/model selection only (`synth.provider`, `synth.model`, `synth.base_url`), never secrets. `_FILE` values get exactly one trailing newline trimmed; a missing `_FILE` target is a hard error. Tier-1 is no longer hardcoded to ollama — `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, and `GROQ_API_KEY` now work, auto-selected in registry order when `synth.provider` is unset.
  - `pl doctor` stops guessing: it reports the resolved provider and source layer, and proves the credential is callable via a live ping (skip with `--no-ping`); broken or unparseable config is now a red failure naming the file, never green-with-warn.
  - Explicit `--config <path>` fails closed on missing, unreadable, or invalid files before any dispatch — a stated config can no longer be silently ignored while a token-burning run proceeds on defaults.
  - New `agent.max_turns` config key and `--max-turns` flag bound `pl investigate` runs the same way `listen.caps.max_turns` bounds listen-dispatched ones.
  - One canonical Ollama base URL, with `/v1` appended in exactly one place; the never-read `PRISMALENS_OLLAMA_BASE_URL` env var is gone.
  - Missing `listen.token` prints one actionable error instead of a stack trace.
  - Engine contract: `SynthesisModelConfig` gains a required `configured: boolean` (set by the host from the resolver outcome; the engine stays env-clean).

- 2c25539: Adds alert storm grouping to `pl listen`. Firing alerts arriving close together are now debounced (default `listen.grouping_window_ms` of 60000ms) into a single group using a coarse key ladder (Alertmanager's `groupKey`/`groupLabels` if present, else `alertname` + service label, else alert labels, else a fallback). One investigation is dispatched per group carrying the full multi-alert context. Alerts arriving while their group's investigation is already running attach to it (deduped by fingerprint or label hash) instead of triggering redundant runs. Group metadata is recorded as a `GroupRecord` with `formedBy: "window"`.
- 0d1b430: New `pl listen` command (Phase 1 R1, #58): a token-authed local HTTP receiver
  for Alertmanager webhooks. Each firing alert triggers a full investigation —
  config and repo resolved per payload — with the report written to the
  run workspace. Invalid payloads get a 4xx with the validation reason; a bounded
  intake queue 503s overflow so Alertmanager's retry absorbs alert storms.
  Configure via the new `listen: { port, token }` section (`pl init` scaffolds
  it, `pl doctor` checks it).

### Patch Changes

- 27fa706: Suppress SQLite ExperimentalWarning on DB actions, strictly reject unknown CLI flags uniformly across commands, add help examples for listen, investigate, and doctor commands, and print absolute file paths with human-readable formatting when config schema validation fails.
- f9dfc13: Fix subscription-only `pl listen`/`pl investigate` runs producing no report (#131, #132). The Tier-1 reduce/synthesis step is the only direct model call in an investigation; with no provider key it fell back to the keyless cloud endpoint, 401'd, and the run was marked errored with nothing persisted — even though the harness's diagnosis was already gathered. Now: when no Tier-1 provider is configured the supervisor skips the model call entirely and persists the harness's submitted branch conclusion(s) as a report clearly marked raw/un-synthesized (#131); and when the reduce model call throws for any reason, the same raw report is salvaged with the synthesis error surfaced in it rather than erroring the run (#132). `pl listen` prints one startup line noting reports will be raw pass-through until a provider is configured (a supported subscription-only path, not a failure). No schema change; raw reports flow through the existing done/finish path and render in `pl report` and Slack.
- Updated dependencies [3b99bdc]
- Updated dependencies [a79f5ef]
- Updated dependencies [f9dfc13]
  - @prismalens/engine@0.1.0
  - @prismalens/config@0.1.0
  - @prismalens/contracts@0.0.2

## 0.0.2

### Patch Changes

- a336543: Harness failure containment. A mid-run harness abort
  (e.g. deepagents killing its whole turn on one tool exception) no longer kills a
  single-branch run: the branch is respawned once in a fresh session, and if that also
  aborts, the failure becomes the branch's terminal `error` event and the reduce step
  still synthesizes a partial report from the evidence already gathered. Setup failures
  before the first event (binary missing, init handshake) still propagate. The
  investigation prompt now pins file reads/searches to the repository working directory
  (deepagents' filesystem tools follow model-supplied absolute paths outside the
  workspace root), and `deepagents-acp` is invoked with an explicit `-w <repo>` since it
  ignores the ACP `session/new` cwd.
- Updated dependencies [a336543]
  - @prismalens/engine@0.0.2

## 0.0.1

### Patch Changes

- 0621354: First public release. The `prismalens` CLI (bins `prismalens` + `pl`) and its
  library closure — `@prismalens/engine`, `@prismalens/contracts`,
  `@prismalens/config` — publish to npm as 0.0.1 under Apache-2.0.
- Updated dependencies [0621354]
  - @prismalens/engine@0.0.1
  - @prismalens/contracts@0.0.1
  - @prismalens/config@0.0.1
