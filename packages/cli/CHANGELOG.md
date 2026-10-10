# prismalens

## [0.5.1](https://github.com/prismalens/prismalens/compare/v0.5.0...v0.5.1) (2026-10-10)


### ⚠ BREAKING CHANGES

* **harness:** supported agents on their own sign-in, no safety verdict, no placement ([#634](https://github.com/prismalens/prismalens/issues/634)) (#707)
* **auth:** no account on the instance; the host pairs through a startup link ([#698](https://github.com/prismalens/prismalens/issues/698)) (#701)
* remove the sandbox providers and every promise about them ([#682](https://github.com/prismalens/prismalens/issues/682))

### Features

* [#673](https://github.com/prismalens/prismalens/issues/673) readiness: pairing proven on the packed tarball, fidelity line, stranger-repo replay ([#711](https://github.com/prismalens/prismalens/issues/711)) ([280c2e8](https://github.com/prismalens/prismalens/commit/280c2e85d666c31b9e40cc4c2d90af90b7ff6021))
* a run reads every repo the incident touches, and a finished investigation takes a follow-up in the same session ([#747](https://github.com/prismalens/prismalens/issues/747)) ([#751](https://github.com/prismalens/prismalens/issues/751)) ([905b8da](https://github.com/prismalens/prismalens/commit/905b8da26a39bd29382a1574b87f9fdc07e1b246))
* **alerts:** an incident resolves when no connected Alertmanager lists its alerts any more ([#605](https://github.com/prismalens/prismalens/issues/605)) ([#728](https://github.com/prismalens/prismalens/issues/728)) ([0e9c74b](https://github.com/prismalens/prismalens/commit/0e9c74b32a52251d17055aa26617bc3848df8348))
* an ask's window ends a minute before the run's wall clock, and the card says so ([#673](https://github.com/prismalens/prismalens/issues/673) w21) ([1aec062](https://github.com/prismalens/prismalens/commit/1aec062b108e7e2b5fd86751a7ba55c7f2b78026))
* **api,engine:** custom models per agent; an added model goes in through the agent's env ([#673](https://github.com/prismalens/prismalens/issues/673) w57) ([85ff35b](https://github.com/prismalens/prismalens/commit/85ff35bdfa92a6391b2a7dd51cd4aa73095b8e49))
* **api,engine:** the context pack names the affected service's upstream dependencies too ([#673](https://github.com/prismalens/prismalens/issues/673) walk 4) ([a5565ac](https://github.com/prismalens/prismalens/commit/a5565ac5662b84825910040c289364c7c1befd1e))
* **api:** a thread's end follows the settlement table; the run owns its row's end ([#673](https://github.com/prismalens/prismalens/issues/673) w59) ([81e3cde](https://github.com/prismalens/prismalens/commit/81e3cde7b6634cddab58364524298d4d33834f7c))
* **api:** a waiting ask is stored, answered over the API, and denied at restart ([#673](https://github.com/prismalens/prismalens/issues/673) w21) ([97ebf09](https://github.com/prismalens/prismalens/commit/97ebf09dd2e5f56ae5909f4d70834df1a3e32481))
* **api:** attachments, the access ceiling, effort and continue on the run path ([c707f96](https://github.com/prismalens/prismalens/commit/c707f96592a9e608cb7e297c52f7b648775056c9))
* **api:** merge one incident into another ([#673](https://github.com/prismalens/prismalens/issues/673) w37) ([cfeb6e3](https://github.com/prismalens/prismalens/commit/cfeb6e308786dad373b1059a5dac73ae787250d5))
* **api:** runs carry agentMode; no write-level ceiling ([#673](https://github.com/prismalens/prismalens/issues/673) w21) ([159307f](https://github.com/prismalens/prismalens/commit/159307f91f5ae97a313bc716033e26aafd4038a3))
* **auth:** devices pair with the host ([#698](https://github.com/prismalens/prismalens/issues/698)) ([#700](https://github.com/prismalens/prismalens/issues/700)) ([5fea4ec](https://github.com/prismalens/prismalens/commit/5fea4ecb4a17eae59413d646c96bed0c65219087))
* **auth:** no account on the instance; the host pairs through a startup link ([#698](https://github.com/prismalens/prismalens/issues/698)) ([#701](https://github.com/prismalens/prismalens/issues/701)) ([c8f9ea6](https://github.com/prismalens/prismalens/commit/c8f9ea6f4a9f8f9cb8fa00ff533f64e1f34c119b))
* Claude Code on a laptop runs on the user's own sign-in ([#663](https://github.com/prismalens/prismalens/issues/663)) ([35df29e](https://github.com/prismalens/prismalens/commit/35df29e915a0da3b098cb2734275930eee001d29))
* **cli:** a failed service upgrade rolls back to the previous version and database ([#766](https://github.com/prismalens/prismalens/issues/766)) ([#770](https://github.com/prismalens/prismalens/issues/770)) ([ccf3624](https://github.com/prismalens/prismalens/commit/ccf362409be0e0b7fcdaf16d098ecc85e1eb7dc4))
* **cli:** pl service runs PrismaLens in the background on Linux and macOS ([#732](https://github.com/prismalens/prismalens/issues/732)) ([#735](https://github.com/prismalens/prismalens/issues/735)) ([0f88ed0](https://github.com/prismalens/prismalens/commit/0f88ed0936940339f977139bdc87fb01487cf519))
* **cli:** reach the box from anywhere over Tailscale HTTPS ([#765](https://github.com/prismalens/prismalens/issues/765)) ([#768](https://github.com/prismalens/prismalens/issues/768)) ([db4d899](https://github.com/prismalens/prismalens/commit/db4d899267a24c23330ebd40863c6f79b61bbf10))
* close an incident, export the report as Markdown, pl reset, update notice ([#661](https://github.com/prismalens/prismalens/issues/661)) ([8bd230a](https://github.com/prismalens/prismalens/commit/8bd230a493e422451035578f5460d18c9cc44210))
* **config,contracts:** a run's mode is the agent's own ACP mode id ([#673](https://github.com/prismalens/prismalens/issues/673) w21) ([1433de6](https://github.com/prismalens/prismalens/commit/1433de6e4766fc103dccd0e5e89ecb0c2920108d))
* **contracts,database:** a thread's live turn and last-message outcome ([#673](https://github.com/prismalens/prismalens/issues/673) w59) ([db63acf](https://github.com/prismalens/prismalens/commit/db63acfe0f1d69b50e6bb25bdbcea1cb59e90911))
* **desktop:** a branded window frame with native controls in the app's colours ([#736](https://github.com/prismalens/prismalens/issues/736)) ([#737](https://github.com/prismalens/prismalens/issues/737)) ([96b99b4](https://github.com/prismalens/prismalens/commit/96b99b40d86d565b8dd1269b010f5c707586425d))
* **desktop:** add hot-reload dev script for the Electron app ([5a385ef](https://github.com/prismalens/prismalens/commit/5a385ef7d4703cd30a910436bd0d623a41afefb5))
* **desktop:** the Electron launcher spawns the backend and adds presence ([#83](https://github.com/prismalens/prismalens/issues/83)) ([#702](https://github.com/prismalens/prismalens/issues/702)) ([2199435](https://github.com/prismalens/prismalens/commit/2199435e1826941859e9f1859be3aacd5326d150))
* **engine,api:** a follow-up on an older run tells the agent a newer run saw newer commits ([#673](https://github.com/prismalens/prismalens/issues/673) w27) ([92aaf46](https://github.com/prismalens/prismalens/commit/92aaf461b3a44d491c884105553feff4168f047c))
* **engine:** check each agent mode's own sandbox, and rest enforced on it ([#673](https://github.com/prismalens/prismalens/issues/673) w51) ([a0c93ea](https://github.com/prismalens/prismalens/commit/a0c93ea0394ee3c6545f5469da45c820a8494f4d))
* **engine:** model and effort over ACP config options, attachments as prompt content, continue a stopped run ([132c1eb](https://github.com/prismalens/prismalens/commit/132c1ebf97e196e87b4a4bea1a165e9662c77e66))
* **engine:** no PrismaLens permission gate; the agent's own mode is the limit ([#673](https://github.com/prismalens/prismalens/issues/673) w21) ([07fd396](https://github.com/prismalens/prismalens/commit/07fd396a7fa201a0f2fe7c1f4f4eb8411e1b387c))
* **engine:** set the agent's own mode, fail fast when it is not offered ([#673](https://github.com/prismalens/prismalens/issues/673) w21, w26) ([470a6a3](https://github.com/prismalens/prismalens/commit/470a6a3da35c8f2e7177edbbe7af5509d827db6b))
* **engine:** the agent's own mode decides and every ask waits on you ([#673](https://github.com/prismalens/prismalens/issues/673) w21) ([7faa2a5](https://github.com/prismalens/prismalens/commit/7faa2a571e2a7da4d0d3a4dc47c64db88504f0d8))
* filter the services list by team ([#671](https://github.com/prismalens/prismalens/issues/671)) ([f8319ff](https://github.com/prismalens/prismalens/commit/f8319ff795abf78ec56679d583a3af480eb1ef4a))
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
* **frontend:** one look system — surface shades, semantic colour, shared controls and motion ([0e8800d](https://github.com/prismalens/prismalens/commit/0e8800d5a8ca0ad8fdb3ec6e91c0853bc63c12ae))
* **frontend:** one primitive per job: Hint, Select, Tabs, Segmented, Row, State, Toast ([77835fc](https://github.com/prismalens/prismalens/commit/77835fc5483c3b15403bc44518befd65e22ed041))
* **frontend:** one send control and a verb chip where both verbs act; Working reads the live turn ([#673](https://github.com/prismalens/prismalens/issues/673) w59) ([7850541](https://github.com/prismalens/prismalens/commit/7850541bfa99c7df24723930b084f8661bc8c79c))
* **frontend:** one sidebar, incident tabs, and an Overview that opens with a summary ([#743](https://github.com/prismalens/prismalens/issues/743)) ([#748](https://github.com/prismalens/prismalens/issues/748)) ([da22975](https://github.com/prismalens/prismalens/commit/da229753cda2ba26d9c19422600afdc9b5d73f1c))
* **frontend:** one visual system and one shell — sidebar doors, Back everywhere, Alerts and devices redesigned ([#779](https://github.com/prismalens/prismalens/issues/779)) ([85636b3](https://github.com/prismalens/prismalens/commit/85636b3727ea38f8798d9a3edfe5bf12be9f41e4))
* **frontend:** one-column incident page, no rail and no Event log; hero report ([#673](https://github.com/prismalens/prismalens/issues/673) w12, w13, w18, w29, w36) ([031585c](https://github.com/prismalens/prismalens/commit/031585c44b3def7b1621befba5b22862ee926559))
* **frontend:** record, conversation, report and picker on the new system ([937ff3a](https://github.com/prismalens/prismalens/commit/937ff3a9215c029d6002afffbedba327aac27e36))
* **frontend:** record, conversation, report and picker on the new system (WIP) ([c1f54a1](https://github.com/prismalens/prismalens/commit/c1f54a15313dcfead919c3c759e7acc8e72ec58d))
* **frontend:** runs live in the sidebar under their incident; the Run chip below 1280 ([#673](https://github.com/prismalens/prismalens/issues/673)) ([23520c8](https://github.com/prismalens/prismalens/commit/23520c85906e2f41025294c9c8d5716f8ce28acd))
* **frontend:** settings on pools and rows ([6f9ea26](https://github.com/prismalens/prismalens/commit/6f9ea266b3ba8d78cbd601885b24064b8293f8b9))
* **frontend:** Settings sections, Alert sources, Services on one page and the agent picker ([#781](https://github.com/prismalens/prismalens/issues/781)) ([75ae038](https://github.com/prismalens/prismalens/commit/75ae038b64def06bd25d6b0bf0da8ed69f3d3d2a))
* **frontend:** Settings, Agent says what OpenCode asks about ([#673](https://github.com/prismalens/prismalens/issues/673) w21) ([028e47c](https://github.com/prismalens/prismalens/commit/028e47c0a7b4b5a8a55dc8666b74f6035562110b))
* **frontend:** surface ladder, text and solid tokens, and the motion sheet ([e2222db](https://github.com/prismalens/prismalens/commit/e2222db4a37c2e5d41540914d3006f5f5e30a7ed))
* **frontend:** the board, first run, Analytics and one-step Resolve ([#780](https://github.com/prismalens/prismalens/issues/780)) ([266d896](https://github.com/prismalens/prismalens/commit/266d89667bee82505fbcdc9bc412a4c663fddf57))
* **frontend:** the box on PromptInput with the same three chips in every run state ([#673](https://github.com/prismalens/prismalens/issues/673) w7, w9, w10, w21, w33) ([b2b75ce](https://github.com/prismalens/prismalens/commit/b2b75ce097d46b95cf398172053413b30230217b))
* **frontend:** the box's chips change only that run ([#673](https://github.com/prismalens/prismalens/issues/673) w52) ([21c6756](https://github.com/prismalens/prismalens/commit/21c6756abc8c7ff64f13dca7a89b86b8e486aadd))
* **frontend:** the conversation on AI Elements and Streamdown, the box's modes, access, effort and attachments ([7fbc9d3](https://github.com/prismalens/prismalens/commit/7fbc9d3927ecfe1c8542e1a96e6e807c71e3fe69))
* **frontend:** the incident record and its report as designed pages ([2064d70](https://github.com/prismalens/prismalens/commit/2064d7054cae11213b8ae8a6f6f34b789d4684c7))
* **frontend:** the incident record and its report as designed pages ([11a70a3](https://github.com/prismalens/prismalens/commit/11a70a372cfbd323442f26f3c296c1cc3d5e8bed))
* **frontend:** the legacy form dialogs speak Resolve's language ([11c6867](https://github.com/prismalens/prismalens/commit/11c68672596d9251fa2c2747dc6714e426ac6c67))
* **frontend:** the mode chip lists the agent's own modes ([#673](https://github.com/prismalens/prismalens/issues/673) w21) ([aeb7e74](https://github.com/prismalens/prismalens/commit/aeb7e7446bf47f9f93fd6b8e6a7d091fa482a2b9))
* **frontend:** the reshape — 32 surfaces to 17 ([#523](https://github.com/prismalens/prismalens/issues/523)) ([#694](https://github.com/prismalens/prismalens/issues/694)) ([4685bca](https://github.com/prismalens/prismalens/commit/4685bcac073438474b7b9679c58233491b2827c1))
* **frontend:** the run strip goes grey and stops its clock while the stream is lost ([db3ec73](https://github.com/prismalens/prismalens/commit/db3ec73b3ad77cf41f89e752b712067dbed012aa))
* **frontend:** the shell on the new system ([a1797fe](https://github.com/prismalens/prismalens/commit/a1797fe5f3daef2759f4c1641a8060f03426c377))
* **frontend:** vendor AI Elements prompt-input and model-selector, shadcn command and input-group ([#673](https://github.com/prismalens/prismalens/issues/673)) ([6043484](https://github.com/prismalens/prismalens/commit/6043484d15d1cfadaba553ae9a95bccd84116b4d))
* harness admission as data — SDK types, version in the record, per-row sign-in and model, Windows shims ([#681](https://github.com/prismalens/prismalens/issues/681)) ([b64ea46](https://github.com/prismalens/prismalens/commit/b64ea46be4c970b843cff254b1a9fa41814ebc43))
* **harness:** a model catalogue, models per agent, drift logged, a run refuses what the agent lacks ([#639](https://github.com/prismalens/prismalens/issues/639)) ([#704](https://github.com/prismalens/prismalens/issues/704)) ([2c968a2](https://github.com/prismalens/prismalens/commit/2c968a2e086275fdd1a1f7902c677eaaeb7ba405))
* **harness:** Gemini CLI never loads the incident repo's own config ([#634](https://github.com/prismalens/prismalens/issues/634)) ([#755](https://github.com/prismalens/prismalens/issues/755)) ([fc27a89](https://github.com/prismalens/prismalens/commit/fc27a895c45f09d4edb25aa8ff7afd5753437560))
* **harness:** record the model the agent reports, flag a substitution, and drop the read-only claim from the report chip ([#639](https://github.com/prismalens/prismalens/issues/639)) ([#727](https://github.com/prismalens/prismalens/issues/727)) ([06d319d](https://github.com/prismalens/prismalens/commit/06d319d596ce0d20e6b8d225571490021d23bce6))
* **harness:** supported agents on their own sign-in, no safety verdict, no placement ([#634](https://github.com/prismalens/prismalens/issues/634)) ([#707](https://github.com/prismalens/prismalens/issues/707)) ([cd00535](https://github.com/prismalens/prismalens/commit/cd00535b22633cf98c5d587fe0d25066ee831521))
* **install:** the whole lifecycle on every channel: pl upgrade, PATH, fallback, rollback, uninstall, and guards for two copies and downgrades ([#717](https://github.com/prismalens/prismalens/issues/717)) ([#721](https://github.com/prismalens/prismalens/issues/721)) ([46d360e](https://github.com/prismalens/prismalens/commit/46d360eb1837e41ed981f4a731cac4d4899f373a))
* investigation and chat are two kinds of one thread ([#673](https://github.com/prismalens/prismalens/issues/673) w59) ([722d4ea](https://github.com/prismalens/prismalens/commit/722d4eaf3db61ec3961443dd74886a9c3ec1df44))
* merge incidents, run-only chips, sandbox-proven lock ([#673](https://github.com/prismalens/prismalens/issues/673) w37, w51, w52) ([224b0e9](https://github.com/prismalens/prismalens/commit/224b0e979565daf246d572ffd06d69787ce60ff8))
* message a running investigation, stop it from anywhere, run state in its own words ([#743](https://github.com/prismalens/prismalens/issues/743)) ([#744](https://github.com/prismalens/prismalens/issues/744)) ([ce41bca](https://github.com/prismalens/prismalens/commit/ce41bca457c8b063d4a9ff520d10d137a10e1d23))
* opt-in PostHog telemetry, asked once, off by default ([#666](https://github.com/prismalens/prismalens/issues/666)) ([5bbc739](https://github.com/prismalens/prismalens/commit/5bbc73967e35efa07190a65a55100d4fcfa109f2))
* post a completed report as a comment on a GitHub issue or PR ([#679](https://github.com/prismalens/prismalens/issues/679)) ([e48cb26](https://github.com/prismalens/prismalens/commit/e48cb261a147a603547067fac93e59ffdc8e6422))
* pull alerts on open from Alertmanager, catch up from Prometheus ([#680](https://github.com/prismalens/prismalens/issues/680)) ([b6e6a77](https://github.com/prismalens/prismalens/commit/b6e6a7792478d1608b4289ea7197c396a3ae1695))
* rebrand to the p-lens glint mark ([#745](https://github.com/prismalens/prismalens/issues/745)) ([#746](https://github.com/prismalens/prismalens/issues/746)) ([2e72095](https://github.com/prismalens/prismalens/commit/2e7209572ef3ff271ca29e255f6390fecedf3cc2))
* record the actual cause on close and cite it in similar incidents ([#667](https://github.com/prismalens/prismalens/issues/667)) ([f2c33a0](https://github.com/prismalens/prismalens/commit/f2c33a0bf5448cbd4d9e3499f8efb8e79f583654))
* **runs:** a run carries its own agent, model and effort ([#673](https://github.com/prismalens/prismalens/issues/673) w52) ([afbd26e](https://github.com/prismalens/prismalens/commit/afbd26e83385b5965161c34587308d9a83ce6795))
* **runs:** a run is a thread, an investigation or a chat ([#673](https://github.com/prismalens/prismalens/issues/673)) ([dbf6b7b](https://github.com/prismalens/prismalens/commit/dbf6b7b1b48a8638402af8ec0d49259da56fa6d6))
* screens reach one PrismaLens per workspace without breaking each other ([#763](https://github.com/prismalens/prismalens/issues/763)) ([#764](https://github.com/prismalens/prismalens/issues/764)) ([90e021b](https://github.com/prismalens/prismalens/commit/90e021b46ec09055e2341fe51c8dcd51e9d8f454))
* telemetry and host facts reach the run ([#678](https://github.com/prismalens/prismalens/issues/678)) ([8cb9712](https://github.com/prismalens/prismalens/commit/8cb9712c52ccb9aa0eaf0853acee7f15adbfa583))
* **telemetry:** EU project, day timestamps, run mode and build, daily presence, recently sent ([#602](https://github.com/prismalens/prismalens/issues/602)) ([#716](https://github.com/prismalens/prismalens/issues/716)) ([3a30a11](https://github.com/prismalens/prismalens/commit/3a30a1134f4ef27f4697805d6a025033a8c34bab))
* **telemetry:** usage data is on after a first-run notice, off by setting or env ([#673](https://github.com/prismalens/prismalens/issues/673) w45) ([e39ecdd](https://github.com/prismalens/prismalens/commit/e39ecdd7641e3065b7ca97729d9ecf0d58570e43))
* the agent's own mode decides, asks reach you, custom models ([#673](https://github.com/prismalens/prismalens/issues/673)) ([87b583c](https://github.com/prismalens/prismalens/commit/87b583c7b43ed8a8e36388ce893e034b497c2e3c))
* the conversation, the box, model and effort over ACP, attachments and continue ([d8583e1](https://github.com/prismalens/prismalens/commit/d8583e1dad450db56c5805344e270fc47e81a0e1))
* the incident band in the desktop title strip, and a follow-up that ends early puts its run back ([#752](https://github.com/prismalens/prismalens/issues/752)) ([#756](https://github.com/prismalens/prismalens/issues/756)) ([bd56d18](https://github.com/prismalens/prismalens/commit/bd56d186e551ca185ae1c3f82c0d0a68807a54e5))
* **ui:** frame, board, settings and services design pass D2 ([#673](https://github.com/prismalens/prismalens/issues/673)) ([46d2d6f](https://github.com/prismalens/prismalens/commit/46d2d6fc06b19ad3981ec9a69b4afd3f5791b718))
* **ui:** incident record design pass D1 ([#673](https://github.com/prismalens/prismalens/issues/673)) ([09504c9](https://github.com/prismalens/prismalens/commit/09504c9332c668014f5bc501716b612398bde00c))
* workspace lock, pl reset-password, cancel reaches the clone, safe resets ([#662](https://github.com/prismalens/prismalens/issues/662)) ([f6cc503](https://github.com/prismalens/prismalens/commit/f6cc50330f6780727dec0a3bc5793f8cd6ffe45e))


### Bug Fixes

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
* a flap refire reopens its resolved incident, and an env-supplied model is never reported as substituted ([#741](https://github.com/prismalens/prismalens/issues/741)) ([8769049](https://github.com/prismalens/prismalens/commit/87690499865914fbf6b165a8ce96c2326f84fa48))
* **admission:** remove the R6 run dir even when setup throws ([3456572](https://github.com/prismalens/prismalens/commit/3456572b79f6a44824c2ca83a3fdbdc8096e55f4))
* **alerts,engine:** two services in one grouped delivery stay two incidents; host facts stay inferred ([#633](https://github.com/prismalens/prismalens/issues/633)) ([#706](https://github.com/prismalens/prismalens/issues/706)) ([2283839](https://github.com/prismalens/prismalens/commit/22838392567fb1ef97d461982c060078a085dd77))
* **alerts:** a refire inside 24 h reopens the incident and starts a run ([#673](https://github.com/prismalens/prismalens/issues/673) w25, w43) ([68ceff2](https://github.com/prismalens/prismalens/commit/68ceff219abf17c860820d562c2a9c177ef81e9b))
* **alerts:** connecting an Alertmanager lists it at once (walk f17) ([9d19bf4](https://github.com/prismalens/prismalens/commit/9d19bf48fa1db646f7b81053e388f834a097c9b7))
* **alerts:** one automatic reopen run per incident per hour ([#673](https://github.com/prismalens/prismalens/issues/673) w25) ([b84e2c6](https://github.com/prismalens/prismalens/commit/b84e2c68d19ed2c26338273ddfefcd13ceeea937))
* an added model reaches Claude Code as its custom model option, then over set_config_option ([#673](https://github.com/prismalens/prismalens/issues/673) w57) ([e82ba1a](https://github.com/prismalens/prismalens/commit/e82ba1a8829bb31610de29ecff3063332b86593d))
* **api:** a restore failure never cancels a follow-up; settled rows' jobs follow them at boot; the receiving turn checks a message's kind ([#804](https://github.com/prismalens/prismalens/issues/804) OBJ-031, OBJ-027, OBJ-032) ([0c5a66b](https://github.com/prismalens/prismalens/commit/0c5a66b6866834830d16610d0ab4e411bd0dba11))
* **api:** a thrown settlement is not applied; a stale Stop never ends a finished run; the job follows a stopped row at boot ([#804](https://github.com/prismalens/prismalens/issues/804) OBJ-024..027) ([15a1f0d](https://github.com/prismalens/prismalens/commit/15a1f0db3867b8b4c71940420ac7a9bc930f4052))
* **api:** an alert arriving mid-investigation is visible, not silently dropped ([#669](https://github.com/prismalens/prismalens/issues/669)) ([53bb654](https://github.com/prismalens/prismalens/commit/53bb65435daf5e920da4f0fe1cf07999f9243958))
* **api:** reading a run is not rate limited, starting or steering one still is ([4557ed7](https://github.com/prismalens/prismalens/commit/4557ed7dba0d999c91b309125bf874b9e13e1ea7))
* **ci:** four flakes at their cause, and parallel e2e with one stack per worker ([5545324](https://github.com/prismalens/prismalens/commit/55453241c8273fa3459102475d9116111303d40c))
* **ci:** keep the app-boot smoke's event loop free while sampling processes ([e4e08ce](https://github.com/prismalens/prismalens/commit/e4e08cedc9ea1a73beb8ec446562bdaf5c2ccfd9))
* **ci:** retry a reset connection in the app-boot smoke script ([#772](https://github.com/prismalens/prismalens/issues/772)) ([4a7f8cc](https://github.com/prismalens/prismalens/commit/4a7f8ccd8297db47729c02d6befdeffcdb2b6b13))
* clear CodeRabbit review on [#797](https://github.com/prismalens/prismalens/issues/797) ([0ac586d](https://github.com/prismalens/prismalens/commit/0ac586d4d5b9ef67be7262f7a572c9156e830aa8))
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
* **desktop:** rebuild better-sqlite3 for Electron when no prebuilt exists ([533230c](https://github.com/prismalens/prismalens/commit/533230ce4917f2a004a2d70db7cdd58687402402))
* **desktop:** ship the bundled server as one asar, not 23k loose files ([#673](https://github.com/prismalens/prismalens/issues/673) w53) ([12041e5](https://github.com/prismalens/prismalens/commit/12041e5d1aa7f40b53eae6ab06aae6e804eaed05))
* **dev:** exclude cli's one-shot bin from turbo run dev ([bae22e5](https://github.com/prismalens/prismalens/commit/bae22e5e91c863d1f684830dac46417f91f601cd))
* **dev:** exclude the cli's one-shot bin from turbo run dev ([be36636](https://github.com/prismalens/prismalens/commit/be36636a44190d41e8af78013199217d414872e7))
* **dev:** pair only loopback browsers; address [#787](https://github.com/prismalens/prismalens/issues/787) review ([6dda50d](https://github.com/prismalens/prismalens/commit/6dda50d9d4bc965bbae332303c94b42a632fc21a))
* **dev:** pair the dev browser and the desktop window automatically ([f384c8d](https://github.com/prismalens/prismalens/commit/f384c8d8887bf2d7f38805506693f9f951871626))
* **dev:** pair the dev browser and the desktop window automatically ([499dc04](https://github.com/prismalens/prismalens/commit/499dc04e50e40df58b00d0e350fd03d9143eadf6))
* **engine,frontend:** Stop during the report retry ends as a stop; report failures read plainly ([#673](https://github.com/prismalens/prismalens/issues/673) w34) ([8738c13](https://github.com/prismalens/prismalens/commit/8738c13f63affe42a5461d452ed4ab2bf4bebcfa))
* **engine:** a stop during harness startup never sends the prompt ([#743](https://github.com/prismalens/prismalens/issues/743)) ([fac519b](https://github.com/prismalens/prismalens/commit/fac519b8371580f7874bf024057ff54b09aaa1ca))
* **engine:** access levels and an honest read-only guardrail, tested against a red-team corpus ([#778](https://github.com/prismalens/prismalens/issues/778)) ([ca53c86](https://github.com/prismalens/prismalens/commit/ca53c86b8a684e3a733a148da307ce9eee5102f2))
* **engine:** an EPIPE no longer hides why the harness died ([#670](https://github.com/prismalens/prismalens/issues/670)) ([9999722](https://github.com/prismalens/prismalens/commit/9999722674050b503491b09ec3d5c86227246756))
* **engine:** Send now carries the queued messages ahead of it, in order ([#673](https://github.com/prismalens/prismalens/issues/673) w33) ([f913553](https://github.com/prismalens/prismalens/commit/f913553e3acebc75c3ad93590ac931d88b3c9aa9))
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
* **frontend:** hide the report JSON that follows prose in the progress panel ([#660](https://github.com/prismalens/prismalens/issues/660)) ([d9c5223](https://github.com/prismalens/prismalens/commit/d9c522303a9e18580ce47b3d68a6c79e07e534a4))
* **frontend:** keep the last board and alert list through a failed refetch ([d373c66](https://github.com/prismalens/prismalens/commit/d373c669840c5b4de7aaa1b76f65b3893e2a158c))
* **frontend:** Resolve counts the cause against its limit and says when it is too long ([#673](https://github.com/prismalens/prismalens/issues/673) walk 4) ([1b8af9a](https://github.com/prismalens/prismalens/commit/1b8af9a8d660409710df3617eae3ec4a48d48ea1))
* **frontend:** scrollbars are thin and tonal, not the browser's default ([#673](https://github.com/prismalens/prismalens/issues/673) walk 4) ([7c738a8](https://github.com/prismalens/prismalens/commit/7c738a8c3411bce841b3ebd1fc843a4fc71dd735))
* **frontend:** settings column left-aligned, harness error and spec copy ([f702019](https://github.com/prismalens/prismalens/commit/f7020192c69475ae62f504ab23e969494f17a796))
* **frontend:** the agent picker wraps long model names, drops the repeated provider prefix and names a model one way ([#673](https://github.com/prismalens/prismalens/issues/673) f7) ([662fc8e](https://github.com/prismalens/prismalens/commit/662fc8eedbb080d9d0432dc3a18f3ccae035af08))
* **frontend:** the board's keyboard drag carries a card a column at a time and says what a drop does ([#673](https://github.com/prismalens/prismalens/issues/673) walk 4) ([ff1c863](https://github.com/prismalens/prismalens/commit/ff1c86318fbabc362465ddce1605a85c18fd9626))
* **frontend:** the box waits for the selected run, so typed text survives its load ([f447154](https://github.com/prismalens/prismalens/commit/f447154f705c9f7caee8892a88375e782299ca2f))
* **frontend:** the composer's chips wrap on a narrow window instead of clipping the mode chip ([#673](https://github.com/prismalens/prismalens/issues/673) walk 4) ([e1e172f](https://github.com/prismalens/prismalens/commit/e1e172f4ddc4a56ad84b3ab59ed47f1f0423c6f3))
* **frontend:** the delete-service dialog names the dependency links that go with the service ([#673](https://github.com/prismalens/prismalens/issues/673) walk 4) ([0d9aa3e](https://github.com/prismalens/prismalens/commit/0d9aa3e31940a5f54f2484d7077701de4e6837e4))
* **frontend:** the dev proxy drops the change stream when the API dies ([1ad0ce4](https://github.com/prismalens/prismalens/commit/1ad0ce46a39b9e7adbc437c252393ce720152a38))
* **frontend:** the incident's Timeline refreshes after Acknowledge, Resolve and Reopen ([#673](https://github.com/prismalens/prismalens/issues/673) walk 4) ([90a809e](https://github.com/prismalens/prismalens/commit/90a809e2f94b4a2e63fb814331dab7a7b6a3c811))
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
* **frontend:** Working says where a live run is when its card waits in Needs you ([#673](https://github.com/prismalens/prismalens/issues/673) walk 4) ([ac3c608](https://github.com/prismalens/prismalens/commit/ac3c6081eca187f4a38dcee4efc214684da10d50))
* GitLab/Bitbucket token usernames, deepagents row runs dcode --acp, codex read-only mode ([#665](https://github.com/prismalens/prismalens/issues/665)) ([21e16ed](https://github.com/prismalens/prismalens/commit/21e16ed63b67655f85fbfe6efd821ca33e9aec31))
* harness behind a proxy, capped alert text, resolution before firing ([#664](https://github.com/prismalens/prismalens/issues/664)) ([2ddbe4c](https://github.com/prismalens/prismalens/commit/2ddbe4cd531393bf6bc809e9214bb66d374bbe7d))
* **harness:** readiness is checked before a run starts; checks run per row ([#673](https://github.com/prismalens/prismalens/issues/673) w9, w17, w8) ([7207968](https://github.com/prismalens/prismalens/commit/7207968a15b3610ec8b779d6ec4ca385f78b1a50))
* **harness:** under WSL a Windows agent shim is the Windows install, never probed ([#673](https://github.com/prismalens/prismalens/issues/673) w8) ([67e52cc](https://github.com/prismalens/prismalens/commit/67e52ccde42fb302311ca445c28f9486802ce7ec))
* **integrations:** refuse an unusable installation token, interpolate a templated tokenUrl ([#668](https://github.com/prismalens/prismalens/issues/668)) ([06d1017](https://github.com/prismalens/prismalens/commit/06d10172fc2ae4250c56fd2732b42cc512cc66ba))
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
* **runs:** permission is the agent's own mode ([#673](https://github.com/prismalens/prismalens/issues/673) walk w21, w26) ([21451a0](https://github.com/prismalens/prismalens/commit/21451a0ce6127ab170492825dad85fd968ed3ce6))
* **settings:** "tested &lt;version&gt;", a "Default" effort chip, per-kind source fields ([#673](https://github.com/prismalens/prismalens/issues/673) w56) ([d7fed2f](https://github.com/prismalens/prismalens/commit/d7fed2f7f2d06246e020d4d6eb2c1c4f48836ac5))
* SQL keeps LF on every checkout, so Windows builds' migration checksums match the published ones ([#722](https://github.com/prismalens/prismalens/issues/722)) ([9d17e9f](https://github.com/prismalens/prismalens/commit/9d17e9f5ebfc536efeb39b7cd7a790825812ff24))
* the 0.5.1 walk's code defects — alert lifecycle, follow-ups, live updates, agent access, stop and reset ([#776](https://github.com/prismalens/prismalens/issues/776)) ([6929f0e](https://github.com/prismalens/prismalens/commit/6929f0e2bdb7787a1b932acd7962b8a1b9719a07))
* **timeline:** the resolve-by-absence reason shows on the Timeline ([#673](https://github.com/prismalens/prismalens/issues/673) w23) ([2f072c1](https://github.com/prismalens/prismalens/commit/2f072c199695743f054c563a3fb3dc5be7613901))
* **turbo:** pass the workspace dir and DB URL through to db:migrate, db:studio, db:reset ([9670177](https://github.com/prismalens/prismalens/commit/96701776560ff27251f2083f43eef22318b47475))
* walk 3 findings ([#673](https://github.com/prismalens/prismalens/issues/673)) ([ded7f33](https://github.com/prismalens/prismalens/commit/ded7f33ec2bf554eab80f96006984b6afced8fb4))
* walk 4 findings ([#673](https://github.com/prismalens/prismalens/issues/673)) ([4801c61](https://github.com/prismalens/prismalens/commit/4801c613f31a2a25d18d30020c2a26baf6b75fec))
* walk leftovers — webhook alerts resolve by absence once their Alertmanager is connected, host device test ([9b7dd9b](https://github.com/prismalens/prismalens/commit/9b7dd9b4d32d36f1d92938b45f655dc10f13d1ec))


### Code Refactoring

* remove the sandbox providers and every promise about them ([#682](https://github.com/prismalens/prismalens/issues/682)) ([e70f87e](https://github.com/prismalens/prismalens/commit/e70f87ec814f882b257ac1bdada841a604c21ebb))

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
