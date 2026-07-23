# Changelog

## [0.5.1](https://github.com/bilal-fazlani/mock-server/compare/v0.5.0...v0.5.1) (2026-07-23)


### Bug Fixes

* **ui:** render new-profile page per request instead of build-time prerender ([7f2440b](https://github.com/bilal-fazlani/mock-server/commit/7f2440bd635d28789fbf876934f754164dcc08df)), closes [#32](https://github.com/bilal-fazlani/mock-server/issues/32)

## [0.5.0](https://github.com/bilal-fazlani/mock-server/compare/v0.4.0...v0.5.0) (2026-07-22)


### ⚠ BREAKING CHANGES

* the named formats `date` and `time` are removed — use the patterns YYYY-MM-DD and HH:mm:ss instead. YYYYMMDD keeps working as a token pattern.

### Features

* replace now format enum with free-form date/time token patterns ([a38618c](https://github.com/bilal-fazlani/mock-server/commit/a38618caaaf1d94e93dd4c26624228e8942c823c)), closes [#30](https://github.com/bilal-fazlani/mock-server/issues/30)

## [0.4.0](https://github.com/bilal-fazlani/mock-server/compare/v0.3.0...v0.4.0) (2026-07-22)


### ⚠ BREAKING CHANGES

* rename _functions.ts to _functions.mjs and <slug>.ts resolvers to <slug>.mjs, removing type annotations; catalog load errors until the rename is done.

### Features

* add `default` fallback transform for missing placeholder values ([814b22f](https://github.com/bilal-fazlani/mock-server/commit/814b22f5ca02e8ddefbb26297af1033bda9db7d4))
* add `lower` and `trim` transforms, with symmetric empty-value handling ([97890d7](https://github.com/bilal-fazlani/mock-server/commit/97890d7b517b2978485629f686df1cdfb4c2d906))
* add `omit` transform to drop a response field when its source is absent ([84d37fe](https://github.com/bilal-fazlani/mock-server/commit/84d37fe813f6655542d27e2ef2539a4c04e0c96a))
* add header: selector for placeholders and profile selection ([4f6fc27](https://github.com/bilal-fazlani/mock-server/commit/4f6fc272ddce70cafe84bf95c380784bd71bbf24)), closes [#9](https://github.com/bilal-fazlani/mock-server/issues/9)
* **catalog:** accept now offsets in placeholder validation ([ee21ba6](https://github.com/bilal-fazlani/mock-server/commit/ee21ba671c510ff9fc05eeb95e41293adf619614))
* **catalog:** bundle OpenAPI component refs into standalone $defs ([b289cd4](https://github.com/bilal-fazlani/mock-server/commit/b289cd491b39cc3ec58eaef1b1df65a6fac632a7))
* **catalog:** load endpoint schemas from a system-level _spec file ([fdb090f](https://github.com/bilal-fazlani/mock-server/commit/fdb090f32f6e839879e84d105353d4f25da8cc03))
* **catalog:** parse system OpenAPI spec and resolve endpoint schemas ([2112e19](https://github.com/bilal-fazlani/mock-server/commit/2112e19d765e4bba6032bf5820e5ec3193539b44))
* **catalog:** surface spec load warnings at startup and in validator ([35948e3](https://github.com/bilal-fazlani/mock-server/commit/35948e39b13cd9fe896cbb84af337e0987321959))
* **fault-sim:** add delay duration parser ([3e98492](https://github.com/bilal-fazlani/mock-server/commit/3e984929b3eb89331c18b90c6df83b5c58007a3c)), closes [#16](https://github.com/bilal-fazlani/mock-server/issues/16)
* **fault-sim:** apply per-fixture response delay via injected sleep ([1f52f76](https://github.com/bilal-fazlani/mock-server/commit/1f52f76761bce2ce1ea229b791143913200eda66)), closes [#16](https://github.com/bilal-fazlani/mock-server/issues/16)
* **fault-sim:** show injected delay on the request console line ([dee368a](https://github.com/bilal-fazlani/mock-server/commit/dee368ac09c13a8697ffd400c115a56c6e38592e)), closes [#16](https://github.com/bilal-fazlani/mock-server/issues/16)
* **fault-sim:** validate fixture delay field at catalog load ([d7ad20c](https://github.com/bilal-fazlani/mock-server/commit/d7ad20c55585d3571c252f79fd7271f1d83d5b80)), closes [#16](https://github.com/bilal-fazlani/mock-server/issues/16)
* flag placeholders over schema-optional body fields with no fallback ([256d598](https://github.com/bilal-fazlani/mock-server/commit/256d5987304b636877a1ca93965fcc9c5c41756e))
* surface both retention windows on the environment page ([da069e6](https://github.com/bilal-fazlani/mock-server/commit/da069e63bab086a5d50b7e8cf91b94bbf3dd90ff)), closes [#6](https://github.com/bilal-fazlani/mock-server/issues/6)
* **template:** now offset parser and renderer module ([42b29d8](https://github.com/bilal-fazlani/mock-server/commit/42b29d80270948d9703196782ec463af9521a398))
* **template:** resolve now relative-time offsets ([6588053](https://github.com/bilal-fazlani/mock-server/commit/65880539d58c7a4d73c21b785eff2437875cf6c1))
* **templating:** add epoch, epochMillis, date, time now formats ([89681f8](https://github.com/bilal-fazlani/mock-server/commit/89681f805429e7b4c4c55f523ead6d0523c9197b)), closes [#8](https://github.com/bilal-fazlani/mock-server/issues/8)
* **templating:** add placeholder expression parser and AST ([c213d3d](https://github.com/bilal-fazlani/mock-server/commit/c213d3dd30e8e01a8e2f816df92087d10f8a7652))
* **templating:** compile user _functions in a sandboxed vm with a timeout ([3ebc000](https://github.com/bilal-fazlani/mock-server/commit/3ebc0009bc23fadb2f5096250a6e340deb141f5b))
* **templating:** discover and scope-resolve user _functions (nearest wins) ([b25c0cf](https://github.com/bilal-fazlani/mock-server/commit/b25c0cf99513aa2fd3c5bc0e8ee5d350699b39df))
* **templating:** dispatch user functions from placeholder evaluation ([ae52b22](https://github.com/bilal-fazlani/mock-server/commit/ae52b221dee9e68b8a17c451a6c4f79ee6c666b8))
* **templating:** emit raw typed value for whole-string placeholders ([#12](https://github.com/bilal-fazlani/mock-server/issues/12)) ([e6b35bd](https://github.com/bilal-fazlani/mock-server/commit/e6b35bd7a2414d6a0e4981a01ca102b1c2db62f1))
* **templating:** export MockFn type and ship a worked _functions example ([0b861ae](https://github.com/bilal-fazlani/mock-server/commit/0b861ae6aa1b0183a553717a7b0358afb9af7626))
* **templating:** let body selectors emit booleans, null, and subtrees ([743f577](https://github.com/bilal-fazlani/mock-server/commit/743f57748ee2e5e3fb824302b246f42563ab75f5)), closes [#23](https://github.com/bilal-fazlani/mock-server/issues/23) [#12](https://github.com/bilal-fazlani/mock-server/issues/12)
* **templating:** load user functions at catalog load and pass them through the request path ([bfb2f0d](https://github.com/bilal-fazlani/mock-server/commit/bfb2f0d2df1282d59d6108cff7ec7035a591edd6))
* **templating:** scope-aware validation of placeholder function calls ([18936cc](https://github.com/bilal-fazlani/mock-server/commit/18936ccf08f90ca480bb9a162378928da50f0649))
* unify author code on mjs-only — drop ts support for functions and resolvers ([c357616](https://github.com/bilal-fazlani/mock-server/commit/c357616142766239c49b96d2379e6779e5d40073)), closes [#26](https://github.com/bilal-fazlani/mock-server/issues/26)


### Bug Fixes

* **build:** download mongodb signing key to file before dearmor ([8d4ba19](https://github.com/bilal-fazlani/mock-server/commit/8d4ba19d5eb7f3fda013b9857c019616a5648294)), closes [#18](https://github.com/bilal-fazlani/mock-server/issues/18)
* expire resolver history for callers with no profile ([95f5ebb](https://github.com/bilal-fazlani/mock-server/commit/95f5ebb4332628b883c0e4a4cfb0cb4591a110ff)), closes [#6](https://github.com/bilal-fazlani/mock-server/issues/6)
* hide global endpoints from the profile create/edit form ([67fb52b](https://github.com/bilal-fazlani/mock-server/commit/67fb52b5e17a5806b7168f0764d21e465c3d0cb1)), closes [#29](https://github.com/bilal-fazlani/mock-server/issues/29)
* match project lane names case-insensitively in feature-lifecycle skill ([75f60fc](https://github.com/bilal-fazlani/mock-server/commit/75f60fc290df75c51ef408995370d8148a25daff))
* **templating:** correct type-import comment in worked example ([94b01e4](https://github.com/bilal-fazlani/mock-server/commit/94b01e4508c2b61fa8f8d0651ef16f55097e917f))
* **templating:** scope quote parsing to token starts, sync docs ([5d082ae](https://github.com/bilal-fazlani/mock-server/commit/5d082ae734c509735c8ef6abb4ac0facfa92432a))
* **templating:** surface user-function errors as placeholder 500s and define typed returns ([bc5d833](https://github.com/bilal-fazlani/mock-server/commit/bc5d8336191d32d5ed18cef13354436c44a255a2))

## [0.3.0](https://github.com/bilal-fazlani/mock-server/compare/v0.2.1...v0.3.0) (2026-07-17)


### ⚠ BREAKING CHANGES

* _dynamic.ts is no longer recognized; the dynamic scenario slug is no longer reserved or auto-injected; trace codes dynamic_* are now resolver_*; scenarioSource 'dynamic' is replaced by a trace.resolver field.

### Features

* add base shadcn form primitives ([e14a03d](https://github.com/bilal-fazlani/mock-server/commit/e14a03db7047e0258b89169b325aba614317a02f))
* add capped dynamic-history store with profile-deletion cleanup ([e43c483](https://github.com/bilal-fazlani/mock-server/commit/e43c48394a1ca6abde962c71257aa50bf9177a5b))
* add class-based dark mode via next-themes (system default) ([ce620f9](https://github.com/bilal-fazlani/mock-server/commit/ce620f90c0b6de520031fa1729c09fcb7baf0d1d))
* add dynamic scenario source and trace field to log types ([bbc0e9a](https://github.com/bilal-fazlani/mock-server/commit/bbc0e9abc7d4d98a1fe801be1c73d374259a3e8f))
* add DYNAMIC_HISTORY_LIMIT env var and environment row ([f2e0486](https://github.com/bilal-fazlani/mock-server/commit/f2e048680ccde6a3898ea7e336d049f2825b7d8c))
* add header theme toggle; convert UI header to Tailwind ([69f2383](https://github.com/bilal-fazlani/mock-server/commit/69f238385bae4ad50a2dfda5039f625797493689))
* add mock-server CLI launcher and npm package metadata ([d622aea](https://github.com/bilal-fazlani/mock-server/commit/d622aeaa4bf809960d5f25e87bff0bfc734b7869))
* add REQUEST_LOG_TTL_DURATION to configure request-log retention ([8db9859](https://github.com/bilal-fazlani/mock-server/commit/8db985910851de88d61a2ee3b96c2c26bd9d3dba))
* add reset-dynamic-history action and button on the profile page ([ed6cd38](https://github.com/bilal-fazlani/mock-server/commit/ed6cd38ebe66fec400c56d2989d002172869ed33))
* add sandboxed _dynamic.ts resolver compile/invoke module ([493e4e6](https://github.com/bilal-fazlani/mock-server/commit/493e4e62ff3432b28ccddd12ad4ac2b6dc2cd66e))
* **api:** GET /ui/api/catalog discovery endpoint ([d404c4e](https://github.com/bilal-fazlani/mock-server/commit/d404c4ea7663a229b7cca9b220645010a0990aee))
* **api:** global-mocks list/set/clear routes ([8943a63](https://github.com/bilal-fazlani/mock-server/commit/8943a63409490265a59933d3b4c90de48f6eb1b7))
* **api:** JSON scenario-selection validator ([e484ef8](https://github.com/bilal-fazlani/mock-server/commit/e484ef86ba96ec189a28b5586f92ceeb737767bc))
* **api:** profile get/put/delete routes ([fc9d5b2](https://github.com/bilal-fazlani/mock-server/commit/fc9d5b2c12550233f069157c6408d281e2ccf33f))
* **api:** profile progress-reset route ([9008144](https://github.com/bilal-fazlani/mock-server/commit/90081440e77822e044f097cbc0b52c1c816a00a8))
* badge resolver-backed scenarios and generalize reset-history button ([a0252f0](https://github.com/bilal-fazlani/mock-server/commit/a0252f08c9f547931b5884306ed344f3a1c5e795))
* bake mongod into the Docker image for the embedded fallback ([f80bf72](https://github.com/bilal-fazlani/mock-server/commit/f80bf72ba37a46b99b5e92e59b30a3a5a25ab8e5))
* carry scenario summary onto ScenarioView ([9ba8ba9](https://github.com/bilal-fazlani/mock-server/commit/9ba8ba9edbbc27db179109caadac45f2e4b82c09))
* compile _dynamic.ts resolvers at startup and expose via runtime ([b02f581](https://github.com/bilal-fazlani/mock-server/commit/b02f58192abede112713f510c92d13d16358460c))
* display app version and git sha in ui, health, and environment page ([ebcd4c1](https://github.com/bilal-fazlani/mock-server/commit/ebcd4c1d228bde0d432cbad528a7d2c8f97c7caa))
* extract optional summary export from TS resolvers ([cba5dba](https://github.com/bilal-fazlani/mock-server/commit/cba5dbaafdf3d8c25343b3b95745c5aca89ef6c3))
* fall back to embedded MongoDB when no connection string is set ([9cc5726](https://github.com/bilal-fazlani/mock-server/commit/9cc5726e20b14f723ed55a08f9e90527fd4698db))
* generalize scenarios to fixture (x.json) or resolver (x.ts) backing ([e4128a7](https://github.com/bilal-fazlani/mock-server/commit/e4128a7dcf71ea22d9fef3f3f2b73911886061a8))
* inject dynamic scenario and add dangling-scenario label helper ([e9737bb](https://github.com/bilal-fazlani/mock-server/commit/e9737bb0f5479e392b9fe7a131e002e016201aa5))
* key resolver history per scenario slug ([4d359f8](https://github.com/bilal-fazlani/mock-server/commit/4d359f820c0aa0fd8cc998aa5d600594a4ff4401))
* **logs:** add before cursor, summary projection, and single-entry fetch ([b1427e6](https://github.com/bilal-fazlani/mock-server/commit/b1427e6f98be1b96fed00b9960ee9f6d212419b2))
* **logs:** add LogSummaryView type and mapper ([93be865](https://github.com/bilal-fazlani/mock-server/commit/93be865aeadad13393f70f35b5b788738d76531a))
* **logs:** add pure list-state helpers for tail/browse/cap logic ([6e2481e](https://github.com/bilal-fazlani/mock-server/commit/6e2481e28b8ec161d465641d948bc7ad042dbd7b))
* **logs:** infinite-scroll history with tail/browse live polling ([9a8cbe4](https://github.com/bilal-fazlani/mock-server/commit/9a8cbe4516cdae1e079c1fd71964e24790d302da))
* **logs:** lazy-load request/response payloads on row expand ([b3455be](https://github.com/bilal-fazlani/mock-server/commit/b3455be29d5ff4acdd9ccaf066496461591877f1))
* parse optional summary from JSON fixtures into scenarioSummaries ([bca1c1f](https://github.com/bilal-fazlani/mock-server/commit/bca1c1f04c5a1363e81c1debb92aab6243be623a))
* patch scenarioSummaries from resolver summary export ([803aae9](https://github.com/bilal-fazlani/mock-server/commit/803aae98eaf3bf41ccb2c9d124bf1e2cd7814201))
* recognize _dynamic.ts in catalog load and reserve the dynamic slug ([5c93005](https://github.com/bilal-fazlani/mock-server/commit/5c93005a1d8bacb9ca72c171235e03f61806caa8))
* rename DYNAMIC_HISTORY_LIMIT env var to RESOLVER_HISTORY_LIMIT ([09c1597](https://github.com/bilal-fazlani/mock-server/commit/09c1597896ebe38fa55fbf6085b6ca98b5c9758a))
* render scenario summary under the friendly name ([3501ee4](https://github.com/bilal-fazlani/mock-server/commit/3501ee45446674d0764c80666126a19a28859bbd))
* reset UI and deletion cleanup for global-mock dynamic history ([f0e97d1](https://github.com/bilal-fazlani/mock-server/commit/f0e97d18bb75e044a654d15c75a792e6bf69e496))
* resolve catalog dir from CATALOG_PATH env ([413830b](https://github.com/bilal-fazlani/mock-server/commit/413830b86b61c1f3647eb8d888e0ff19750de69a))
* resolver description export and slug-addressed resolver files ([e0a4118](https://github.com/bilal-fazlani/mock-server/commit/e0a41183d1bb3d155a02f1028b8e89263793dd45))
* run _dynamic.ts resolver and rewrite scenario slug in the router ([e8272a6](https://github.com/bilal-fazlani/mock-server/commit/e8272a6e6a67fc4f132542f6409e021bbe51a554))
* show a dynamic scenario card on the catalog endpoint page ([ba76042](https://github.com/bilal-fazlani/mock-server/commit/ba76042045223b558a398e74d7843d1fa26a63c2))
* show dangling scenario pins as disabled unavailable options ([2c4dcff](https://github.com/bilal-fazlani/mock-server/commit/2c4dcff82a61301283164d579be4cf5244cedf60))
* show highlighted resolver source and fixture json on catalog page ([fe6b041](https://github.com/bilal-fazlani/mock-server/commit/fe6b041f16ab0029e157a75d45ac4ffaf856fb61))
* show resolver picked-vs-returned scenario in request logs ([f0cbfdd](https://github.com/bilal-fazlani/mock-server/commit/f0cbfddb40649b6c770fd87b2aff3ea8fe1c5c3b))
* validate resolver-backed scenario rules at startup ([8572aba](https://github.com/bilal-fazlani/mock-server/commit/8572aba74745c940b148abc80b9deb5e4783f210))


### Bug Fixes

* add dark: variants so custom overrides beat shadcn primitives' baked-in dark classes ([e47158d](https://github.com/bilal-fazlani/mock-server/commit/e47158d1b08fbc2e2c37a1ae6cefb98d7e6afd9e))
* classify resolver timeouts by error code, not message text ([ab4aec2](https://github.com/bilal-fazlani/mock-server/commit/ab4aec2d527c4200fe548989ce95c87994422a50))
* contain long request-log payload lines in a scrollable block ([0df8365](https://github.com/bilal-fazlani/mock-server/commit/0df83652eaa84a9d655f36a7b3a4779c6a9f47ca))
* correct method badge gray and schema icon size ([fe64ea2](https://github.com/bilal-fazlani/mock-server/commit/fe64ea21774f2f48eeb3e6e92e40f7b3ec1b41f4))
* exclude removed-catalog endpoints from the profile Save guard ([97c7f95](https://github.com/bilal-fazlani/mock-server/commit/97c7f950da6e728155063be26e3e282e69d707e6))
* harden dynamic resolver against dev compile errors, input mutation, and missing CLI check ([048b803](https://github.com/bilal-fazlani/mock-server/commit/048b80385c636842ceb8b9394226b8db8836e6c9))
* highlight only the fixture body on the catalog card ([041466b](https://github.com/bilal-fazlani/mock-server/commit/041466bd8b3031a4b3d15d9a5926766e03d298ad))
* include ScenarioPicker.tsx Tailwind rewrite in prior commit ([80c66fb](https://github.com/bilal-fazlani/mock-server/commit/80c66fbc5b17c98fb95cf77e4db131b0faa16691))
* keep standalone bundle lean (exclude non-runtime files from tracing) ([ec05259](https://github.com/bilal-fazlani/mock-server/commit/ec052592d06f887552d672fcefdc15cfd1283520))
* **logs:** bound pending buffer and guard stale poll/loadOlder responses ([6c13e72](https://github.com/bilal-fazlani/mock-server/commit/6c13e72516c9d6d7ae7940229604b3ef2cdbb748))
* **logs:** keep log rows at natural height in the scroll container ([574bbe9](https://github.com/bilal-fazlani/mock-server/commit/574bbe99173f0e4b484cd1fd2cd537a15e575188))
* make shadcn Button variants explicit so base button styles don't leak ([28f34fb](https://github.com/bilal-fazlani/mock-server/commit/28f34fb8632b2f880554bf8f96e814d630c5706f))
* make stale detection dynamic-aware and block save on unresolved stale pins ([454b078](https://github.com/bilal-fazlani/mock-server/commit/454b0780171515cb82917dccd2602e7fbccb84ae))
* mark esbuild as a server-external package for Next/Turbopack ([eb5138b](https://github.com/bilal-fazlani/mock-server/commit/eb5138b545c8095c68b56f3dd398f0430ec43e08))
* match Docker build libc to runtime and harden runner image ([52dba9a](https://github.com/bilal-fazlani/mock-server/commit/52dba9a714fbae8396cbf3f15cda2173753df4f2))
* materialize standalone symlinks so the packed tarball is self-contained; propagate signal exit codes ([e7bc7b0](https://github.com/bilal-fazlani/mock-server/commit/e7bc7b00949eb7bf9b0a8969538e98c1697cb92d))
* pin npm 11 wherever npm ci runs to match lockfile's npm major ([0c5765c](https://github.com/bilal-fazlani/mock-server/commit/0c5765cd362cc02d83f19d1b870d3dbda7410078))
* reconcile stale dynamicHistory index on upgrade ([be3731f](https://github.com/bilal-fazlani/mock-server/commit/be3731f9926b8026792a3d5e89db2488106e516d))
* regenerate package-lock.json on linux to fix npm ci EBADPLATFORM ([e56e4c1](https://github.com/bilal-fazlani/mock-server/commit/e56e4c1fb97a28e826e2b8cf4984112e17d6797e))
* regenerate package-lock.json so npm ci resolves all esbuild platform deps ([da3557f](https://github.com/bilal-fazlani/mock-server/commit/da3557f64b8915b489ce9f9336639b61342eea55))
* reset embedded-mongo singleton on boot failure so it retries ([cf38193](https://github.com/bilal-fazlani/mock-server/commit/cf3819303c8b60b36501c16d6597d3281288703b))
* **scenarios:** allow setting dynamic on resolver-backed endpoints ([3511bd7](https://github.com/bilal-fazlani/mock-server/commit/3511bd7628f98669aaf51dd6300e237ca5d36c64)), closes [#1](https://github.com/bilal-fazlani/mock-server/issues/1)
* show global reset-resolver-history button for implicit resolver-backed default ([f587952](https://github.com/bilal-fazlani/mock-server/commit/f5879526790694eed095f2910f61a3c27c3f65a9))
* suppress hover underline on shadcn Button (base a:hover leaked onto asChild link buttons) ([955dc34](https://github.com/bilal-fazlani/mock-server/commit/955dc344990562a623ad476bfc9265b205112045))
* tolerate a single trailing slash in path templates ([8fcedaf](https://github.com/bilal-fazlani/mock-server/commit/8fcedaf2e5b29b3027da9483ca2bc781b1a81956))
* tolerate a single trailing slash in path templates ([07641e3](https://github.com/bilal-fazlani/mock-server/commit/07641e3b64598c7c88acb8efa05b65aae6f7faec))
* wrap base element styles in [@layer](https://github.com/layer) base so Tailwind utilities win ([4ccafc9](https://github.com/bilal-fazlani/mock-server/commit/4ccafc92842d0db471871c9155de9d8451b84815))


### Performance Improvements

* index requestLogs { ts:-1, logId:-1 } to fix slow first logs load ([120cad6](https://github.com/bilal-fazlani/mock-server/commit/120cad63b408a22b5428be5c1f8304b3189b133f))

## [0.2.1](https://github.com/bilal-fazlani/mock-server/compare/mock-server-v0.2.0...mock-server-v0.2.1) (2026-07-16)


### Bug Fixes

* regenerate package-lock.json on linux to fix npm ci EBADPLATFORM ([e56e4c1](https://github.com/bilal-fazlani/mock-server/commit/e56e4c1fb97a28e826e2b8cf4984112e17d6797e))
* regenerate package-lock.json so npm ci resolves all esbuild platform deps ([da3557f](https://github.com/bilal-fazlani/mock-server/commit/da3557f64b8915b489ce9f9336639b61342eea55))

## [0.2.0](https://github.com/bilal-fazlani/mock-server/compare/mock-server-v0.1.0...mock-server-v0.2.0) (2026-07-16)


### Features

* add base shadcn form primitives ([e14a03d](https://github.com/bilal-fazlani/mock-server/commit/e14a03db7047e0258b89169b325aba614317a02f))
* add capped dynamic-history store with profile-deletion cleanup ([e43c483](https://github.com/bilal-fazlani/mock-server/commit/e43c48394a1ca6abde962c71257aa50bf9177a5b))
* add class-based dark mode via next-themes (system default) ([ce620f9](https://github.com/bilal-fazlani/mock-server/commit/ce620f90c0b6de520031fa1729c09fcb7baf0d1d))
* add dynamic scenario source and trace field to log types ([bbc0e9a](https://github.com/bilal-fazlani/mock-server/commit/bbc0e9abc7d4d98a1fe801be1c73d374259a3e8f))
* add DYNAMIC_HISTORY_LIMIT env var and environment row ([f2e0486](https://github.com/bilal-fazlani/mock-server/commit/f2e048680ccde6a3898ea7e336d049f2825b7d8c))
* add header theme toggle; convert UI header to Tailwind ([69f2383](https://github.com/bilal-fazlani/mock-server/commit/69f238385bae4ad50a2dfda5039f625797493689))
* add mock-server CLI launcher and npm package metadata ([d622aea](https://github.com/bilal-fazlani/mock-server/commit/d622aeaa4bf809960d5f25e87bff0bfc734b7869))
* add reset-dynamic-history action and button on the profile page ([ed6cd38](https://github.com/bilal-fazlani/mock-server/commit/ed6cd38ebe66fec400c56d2989d002172869ed33))
* add sandboxed _dynamic.ts resolver compile/invoke module ([493e4e6](https://github.com/bilal-fazlani/mock-server/commit/493e4e62ff3432b28ccddd12ad4ac2b6dc2cd66e))
* **api:** GET /ui/api/catalog discovery endpoint ([d404c4e](https://github.com/bilal-fazlani/mock-server/commit/d404c4ea7663a229b7cca9b220645010a0990aee))
* **api:** global-mocks list/set/clear routes ([8943a63](https://github.com/bilal-fazlani/mock-server/commit/8943a63409490265a59933d3b4c90de48f6eb1b7))
* **api:** JSON scenario-selection validator ([e484ef8](https://github.com/bilal-fazlani/mock-server/commit/e484ef86ba96ec189a28b5586f92ceeb737767bc))
* **api:** profile get/put/delete routes ([fc9d5b2](https://github.com/bilal-fazlani/mock-server/commit/fc9d5b2c12550233f069157c6408d281e2ccf33f))
* **api:** profile progress-reset route ([9008144](https://github.com/bilal-fazlani/mock-server/commit/90081440e77822e044f097cbc0b52c1c816a00a8))
* bake mongod into the Docker image for the embedded fallback ([f80bf72](https://github.com/bilal-fazlani/mock-server/commit/f80bf72ba37a46b99b5e92e59b30a3a5a25ab8e5))
* compile _dynamic.ts resolvers at startup and expose via runtime ([b02f581](https://github.com/bilal-fazlani/mock-server/commit/b02f58192abede112713f510c92d13d16358460c))
* fall back to embedded MongoDB when no connection string is set ([9cc5726](https://github.com/bilal-fazlani/mock-server/commit/9cc5726e20b14f723ed55a08f9e90527fd4698db))
* inject dynamic scenario and add dangling-scenario label helper ([e9737bb](https://github.com/bilal-fazlani/mock-server/commit/e9737bb0f5479e392b9fe7a131e002e016201aa5))
* **logs:** add before cursor, summary projection, and single-entry fetch ([b1427e6](https://github.com/bilal-fazlani/mock-server/commit/b1427e6f98be1b96fed00b9960ee9f6d212419b2))
* **logs:** add LogSummaryView type and mapper ([93be865](https://github.com/bilal-fazlani/mock-server/commit/93be865aeadad13393f70f35b5b788738d76531a))
* **logs:** add pure list-state helpers for tail/browse/cap logic ([6e2481e](https://github.com/bilal-fazlani/mock-server/commit/6e2481e28b8ec161d465641d948bc7ad042dbd7b))
* **logs:** infinite-scroll history with tail/browse live polling ([9a8cbe4](https://github.com/bilal-fazlani/mock-server/commit/9a8cbe4516cdae1e079c1fd71964e24790d302da))
* **logs:** lazy-load request/response payloads on row expand ([b3455be](https://github.com/bilal-fazlani/mock-server/commit/b3455be29d5ff4acdd9ccaf066496461591877f1))
* recognize _dynamic.ts in catalog load and reserve the dynamic slug ([5c93005](https://github.com/bilal-fazlani/mock-server/commit/5c93005a1d8bacb9ca72c171235e03f61806caa8))
* reset UI and deletion cleanup for global-mock dynamic history ([f0e97d1](https://github.com/bilal-fazlani/mock-server/commit/f0e97d18bb75e044a654d15c75a792e6bf69e496))
* resolve catalog dir from CATALOG_PATH env ([413830b](https://github.com/bilal-fazlani/mock-server/commit/413830b86b61c1f3647eb8d888e0ff19750de69a))
* run _dynamic.ts resolver and rewrite scenario slug in the router ([e8272a6](https://github.com/bilal-fazlani/mock-server/commit/e8272a6e6a67fc4f132542f6409e021bbe51a554))
* show a dynamic scenario card on the catalog endpoint page ([ba76042](https://github.com/bilal-fazlani/mock-server/commit/ba76042045223b558a398e74d7843d1fa26a63c2))
* show dangling scenario pins as disabled unavailable options ([2c4dcff](https://github.com/bilal-fazlani/mock-server/commit/2c4dcff82a61301283164d579be4cf5244cedf60))


### Bug Fixes

* add dark: variants so custom overrides beat shadcn primitives' baked-in dark classes ([e47158d](https://github.com/bilal-fazlani/mock-server/commit/e47158d1b08fbc2e2c37a1ae6cefb98d7e6afd9e))
* classify resolver timeouts by error code, not message text ([ab4aec2](https://github.com/bilal-fazlani/mock-server/commit/ab4aec2d527c4200fe548989ce95c87994422a50))
* correct method badge gray and schema icon size ([fe64ea2](https://github.com/bilal-fazlani/mock-server/commit/fe64ea21774f2f48eeb3e6e92e40f7b3ec1b41f4))
* exclude removed-catalog endpoints from the profile Save guard ([97c7f95](https://github.com/bilal-fazlani/mock-server/commit/97c7f950da6e728155063be26e3e282e69d707e6))
* harden dynamic resolver against dev compile errors, input mutation, and missing CLI check ([048b803](https://github.com/bilal-fazlani/mock-server/commit/048b80385c636842ceb8b9394226b8db8836e6c9))
* include ScenarioPicker.tsx Tailwind rewrite in prior commit ([80c66fb](https://github.com/bilal-fazlani/mock-server/commit/80c66fbc5b17c98fb95cf77e4db131b0faa16691))
* keep standalone bundle lean (exclude non-runtime files from tracing) ([ec05259](https://github.com/bilal-fazlani/mock-server/commit/ec052592d06f887552d672fcefdc15cfd1283520))
* **logs:** bound pending buffer and guard stale poll/loadOlder responses ([6c13e72](https://github.com/bilal-fazlani/mock-server/commit/6c13e72516c9d6d7ae7940229604b3ef2cdbb748))
* **logs:** keep log rows at natural height in the scroll container ([574bbe9](https://github.com/bilal-fazlani/mock-server/commit/574bbe99173f0e4b484cd1fd2cd537a15e575188))
* make shadcn Button variants explicit so base button styles don't leak ([28f34fb](https://github.com/bilal-fazlani/mock-server/commit/28f34fb8632b2f880554bf8f96e814d630c5706f))
* make stale detection dynamic-aware and block save on unresolved stale pins ([454b078](https://github.com/bilal-fazlani/mock-server/commit/454b0780171515cb82917dccd2602e7fbccb84ae))
* mark esbuild as a server-external package for Next/Turbopack ([eb5138b](https://github.com/bilal-fazlani/mock-server/commit/eb5138b545c8095c68b56f3dd398f0430ec43e08))
* match Docker build libc to runtime and harden runner image ([52dba9a](https://github.com/bilal-fazlani/mock-server/commit/52dba9a714fbae8396cbf3f15cda2173753df4f2))
* materialize standalone symlinks so the packed tarball is self-contained; propagate signal exit codes ([e7bc7b0](https://github.com/bilal-fazlani/mock-server/commit/e7bc7b00949eb7bf9b0a8969538e98c1697cb92d))
* reset embedded-mongo singleton on boot failure so it retries ([cf38193](https://github.com/bilal-fazlani/mock-server/commit/cf3819303c8b60b36501c16d6597d3281288703b))
* **scenarios:** allow setting dynamic on resolver-backed endpoints ([3511bd7](https://github.com/bilal-fazlani/mock-server/commit/3511bd7628f98669aaf51dd6300e237ca5d36c64)), closes [#1](https://github.com/bilal-fazlani/mock-server/issues/1)
* suppress hover underline on shadcn Button (base a:hover leaked onto asChild link buttons) ([955dc34](https://github.com/bilal-fazlani/mock-server/commit/955dc344990562a623ad476bfc9265b205112045))
* wrap base element styles in [@layer](https://github.com/layer) base so Tailwind utilities win ([4ccafc9](https://github.com/bilal-fazlani/mock-server/commit/4ccafc92842d0db471871c9155de9d8451b84815))
