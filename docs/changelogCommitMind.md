# Changelog CommitMind

## 2026-08-15

- Added a "Project Context" section to the dashboard startup results, displaying module, entity, user role, and unresolved field counts.
- Implemented build context preparation service that analyzes file inventories, classifies files into modules, and extracts manifest descriptions.
- Added build context finalization service that validates semantic evidence and generates PROJECT_CONTEXT.json with resolved project type, purpose, and domain information.
- Introduced module assignment logic that groups files by manifest roots with fallback to top-level directories.
- Added support for extracting and validating descriptions from common manifest formats including package.json, composer.json, pyproject.toml, and Cargo.toml.

- Added project-scoped stage completion tracking in the mock cloud server to prevent cross-project state leakage.
- Extended the `/workflows/current` endpoint with a `projectId` query parameter for project-specific workflow stage responses.
- Associated job submissions and verification results with their project ID for accurate stage status reporting.

- Added document index result section to dashboard showing document, reference, missing document, and glossary term counts
- Added dependency map result section to dashboard displaying package and technology counts
- Extended startup execution metadata type definitions to support new index and dependency map result data
- Added support for parsing package manifests including package.json, pyproject.toml, and other dependency files
- Integrated document parsing capabilities for PDF and DOCX file formats
- Added dynamic stage status tracking to the mock cloud server for realistic workflow simulation
- Implemented stage completion detection based on job acknowledgment and verification results
- Updated workflow stage responses to reflect actual progress of startup and discovery phases

## 2026-08-14

- `010-Startup` akisi `JOB.md` ile uyumlu olarak Job 5 `build_source_manifest`,
  Job 6 `build_factory_manifest` ve Job 7 `seal_run` sonuna kadar baglandi.
- Exe artik RULE-A06 ile `SOURCE_MANIFEST.csv`, RULE-A07 ile
  `FACTORY_MANIFEST.csv`, RULE-A08 ile `PRE_RUN_MANIFEST.json` ve
  `RUN_SEAL.json` uretiyor; her adimdan sonra mock cloud ilgili rule dosyasini
  runtime'da okuyarak LLM dogrulama prompt'u olusturuyor.
- Dashboard final manifest ve seal sonuclarini gosterecek sekilde genisletildi;
  startup servis ve job zinciri testleri Job 7'ye kadar kapsandi.
- Dashboard progress ve Activity listesi zamanlayici tahminlerinden cikarildi;
  `jobs:progress` push kanali ile JobService'in gercek handshake, workflow,
  local exe ve LLM dogrulama adimlarindan gelen olaylara baglandi.
- `waiting_for_input` gibi ara duruslarda bar artik sona atlamiyor ve henuz
  calismamis Job 4 gibi adimlar ekranda yapilmis gibi gosterilmiyor.
- LLM dogrulamasi gibi uzun bekleme adimlarinda progress bar'a canli hareket
  eklendi; Activity listesi kendi icinde kayacak sekilde sinirlandirilarak output
  paneliyle sikisma engellendi.
- Activity satirlari `stepId` bazli duruma cevrildi; ayni is devam ederken yeni
  satira gecmek yerine mevcut satir guncelleniyor ve yeni satir yalnizca gercek
  yeni is basladiginda aciliyor.
- Activity paneli yalnizca en son 10 islemi, en yeni islem en ustte olacak
  sekilde gosteriyor; panel icindeki scroll kaldirildi.
- Job 3 `waiting_for_input` sonucunda Dashboard'a `Open SCOPE.md` ve
  `Open BASELINE.md` aksiyonlari eklendi; dosyalar tipli preload IPC uzerinden
  proje kokunun disina cikmadan sistem editorunde aciliyor.
- Startup input dosyasi acma kanali Zod semalari, main-process path guard
  kontrolu ve IPC testleriyle dogrulandi.
- `010-Startup` akisi Job 4 `capture_git_state` ile genisletildi; Job 3
  `ready` oldugunda exe RULE-A05 algoritmasiyla secili run klasorune
  `git-head.txt`, `git-status.txt` ve `working-tree.patch` dosyalarini yaziyor.
- Git deposu olmayan veya git komutlari hata veren projelerde uc dosyanin
  tamamına `NO GIT REPOSITORY` yaziliyor ve `has_git: false` mesru sonuc olarak
  donduruluyor.
- Mock cloud, `050-capture_git_state.rules.md` dosyasini runtime'da okuyarak
  Job 4 LLM dogrulama prompt'unu olusturuyor.
- RULE-A04 guncellemesine uyumlu olarak `SCOPE.md` template'i artik proje
  kokundeki ust duzey dosya/klasorleri tarayip Include/Exclude listelerini
  dolduruyor; kaynak disi klasorler ve `.gitignore` desenleri Exclude tarafina
  aliniyor.
- Added place_inputs job to the startup flow that places SCOPE.md and BASELINE.md into the selected run folder using RULE-A04.
- Implemented fallback logic that copies approved root files or writes tr-TR templates, reporting waiting_for_input status when review markers remain.
- Extended the Dashboard to display place_inputs results including status, run ID, and file placement details.
- Updated mock cloud to read the 040-place_inputs.rules.md file at runtime for LLM verification prompt generation.
- Added unit tests covering template placement, root file copying, and the chained job service flow.

- `010-Startup` akisi Job 3 `place_inputs` ile genisletildi; Job 2 LLM sonucu
  `ok: true` ve karar `already_sealed` degilse exe RULE-A04 algoritmasiyla secili
  run klasorune `SCOPE.md` ve `BASELINE.md` dosyalarini yerlestiriyor.
- Proje kokunde onayli `SCOPE.md`/`BASELINE.md` varsa run klasorune kopyalaniyor;
  yoksa sabit tr-TR template yaziliyor ve marker/bos dosya durumunda
  `waiting_for_input` mesru bekleme sonucu olarak donduruluyor.
- Mock cloud, `040-place_inputs.rules.md` dosyasini runtime'da okuyarak Job 3
  LLM dogrulama prompt'unu olusturuyor.
- Added select_run job to the startup flow that selects the AI Factory run folder using RULE-A03 after LLM verification passes
- Extended the job service to chain a second provider verification when the first returns ok: true
- Added run selection result display to the Dashboard with decision and run ID
- Updated mock cloud to read the select_run rules file at runtime for the second job verification prompt
- Added newRun option to job run requests and run selection logic supporting new, continue, and already_sealed decisions

- `010-Startup` akisi Job 2 `select_run` ile genisletildi; Job 1 LLM sonucu
  `ok: true` oldugunda exe RULE-A03 algoritmasiyla `.ai-factory-runs/`,
  `.gitignore`, son kosu secimi ve `new`/`continue`/`already_sealed` kararini
  uretiyor.
- Mock cloud, `030-select_run.rules.md` dosyasini runtime'da okuyarak Job 2
  LLM dogrulama prompt'unu olusturuyor; provider dogrulamasi ikinci job olarak
  ayni run zincirinde calisiyor.
- Added live activity panel to Dashboard showing step-by-step operation messages during stage runs
- Added animated progress bar with scanning effect and real-time progress percentage updates
- Added startup execution result section displaying `.ai-factory` directory and config file details
- Added current operation status display that updates in real-time during job execution
- Added activity tracking to job store with timed progress updates for startup stage runs

- Added a project-specific dashboard page that displays AI Factory workflow stages and enables running the startup stage directly from the UI.
- Introduced a new `jobs:workflow` IPC/preload surface for loading workflow data from the mock cloud.
- Enhanced the startup job execution to perform local rule checks, ensuring the `.ai-factory` directory and configuration file exist before sending the cloud request.
- Updated the project "Open" action to navigate to the dashboard and load the workflow for the selected project.
- Added dashboard styling for stage lists, progress tracking, and responsive layout adjustments.

- `010-Startup` stage baslatildiginda exe tarafinda RULE-A01/RULE-A02 mekanik
  islemleri eklendi; aktif proje kokunde `.ai-factory/` klasoru ve
  `.ai-factory/factory.config.yaml` garanti ediliyor, config degerleri okunup
  `localExecution` olarak mock cloud job istegine ekleniyor.
- Mock cloud, `010-check_factory.rules.md` ve `020-read_config.rules.md`
  dosyalarini runtime'da okuyarak LLM dogrulama prompt'unu gercek rule
  icerikleriyle olusturuyor; Dashboard son satirdaki JSON sonucu ayiklayip
  gorunur hale getiriyor.
- Dashboard'a `010-Startup` calisirken hareketli progress, guncel islem mesaji,
  adim adim islem bilgisi ve exe'nin `.ai-factory`/config sonucunu gosteren
  calisma geri bildirimi eklendi.
- Proje listesindeki `Open` aksiyonu proje baglamli temiz Dashboard sayfasina
  gecis yapacak sekilde baglandi; Dashboard, mock cloud workflow stage listesini
  `jobs:workflow` IPC/preload yuzeyinden render ediyor ve ilk hazir stage olan
  `010-Startup` icin provider calistirma butonu sunuyor.
- Faz 6 kapsaminda AI Factory Cloud istemci temeli eklendi; HTTPS-only
  `httpClient`, `safeStorage` tabanli credential store, `jobService`,
  `jobs:*` IPC/preload yuzeyi ve mock cloud run paneli baglandi.
- `corepack pnpm dev:mock-cloud` komutu ile calisan yerel mock cloud server
  eklendi; handshake, workflow, job request/get, heartbeat, result, fail ve
  findings sync endpoint'leri ayni Zod sozlesmelerine gore calisiyor.
- Job service mock cloud'dan gelen task'i secili gercek provider/model uzerinden
  calistirip stdout/stderr sonucunu cloud'a geri gonderebiliyor.
- Manuel task paneline `Run Provider` eklendi; secili proje, provider ve model
  ile gercek Claude Code/Codex CLI calistirma akisi UI'dan baslatilabiliyor.
  Echo fixture `Test Echo` olarak korundu.

- Settings ekranı eklendi; aktif provider ve provider'a göre model tercihi
  `userData/settings.json` içinde kalıcı saklanıyor, task paneli artık ilk kurulu
  provider yerine seçili provider/model ayarını kullanıyor.
- Faz 5 kapsamında güvenli `spawn` tabanlı `processManager`, task execution
  service, `tasks:start`/`tasks:stop` IPC handler'ları ve preload event abonelikleri
  eklendi; stdout/stderr ve exit olayları renderer'a tipli push kanalından akıyor.
- Renderer tarafına seçili proje ve kurulu provider ile çalışan manuel `Run Echo`
  fixture paneli eklendi; bu panel gerçek child process çalıştırır ama AI provider
  çağrısı yapmadan süreç yaşam döngüsünü doğrular.
- Süreç çalıştırma proje köküyle sınırlandırıldı, shell kullanılmadı, environment
  değişkenleri allowlist ile aktarıldı ve task talimat gövdeleri diske yazılmadan
  bellekte process'e iletildi.
- Windows provider tespitinde `where.exe` çıktısındaki uzantısız/npm shim yolları
  yerine gerçek `.exe` adayları önceliklendirildi; kurulu CLI için versiyon
  okunamazsa UI artık yanlış `not detected` mesajı göstermiyor.
- Provider tespitinde başarılı `execFile` çağrılarının exit code'u `0` yerine
  `null` yorumlandığı için CLI'ların yanlışlıkla `Not installed` görünmesi
  düzeltildi.
- Faz 4 kapsamında Claude Code ve Codex için güvenli `execFile` tabanlı CLI
  tespiti eklendi; `ProviderRegistry`, provider adaptör iskeletleri, versiyon
  okuma, provider IPC handler'ları ve preload API yüzeyi bağlandı.
- Renderer tarafına Environment Check içinde provider paneli eklendi; Claude Code
  ve Codex durumları ekranda `Installed`, `Not installed` veya `Error` olarak
  görülebilir ve `Check Again` ile yenilenebilir.
- Git kurulum/sürüm tespiti için temel `gitDetect` modülü eklendi; provider
  tespiti, registry, IPC ve Git davranışları testlerle doğrulandı.
- Geliştirme modunda React Vite preamble'ının CSP tarafından engellenip beyaz ekran
  oluşturması düzeltildi; dev CSP yalnızca geliştirme sırasında inline Vite
  preamble'a izin verirken production `script-src 'self'` davranışı korunuyor.
- Dev açılışında Chromium DevTools iç uyarılarının terminali kirletmemesi için
  DevTools otomatik açılışı kapatıldı; gerektiğinde `FORGEPILOT_OPEN_DEVTOOLS=1`
  ile manuel açılacak hale getirildi.
- Faz 3 kapsamında yerel proje yönetimi eklendi; kullanıcı native klasör seçme
  dialog'u ile proje ekleyebilir, projeler `userData/projects.json` içinde kalıcı
  tutulur, açma/kaldırma akışı tipli IPC ve preload API üzerinden çalışır.
- Renderer tarafında ilk gerçek Projects ekranı ve Zustand tabanlı proje store'u
  eklendi; proje listesi, aktif proje durumu, ekleme, açma, kaldırma ve hata/durum
  mesajları görünür hale getirildi.
- Proje kökü güvenliği için `pathGuard` eklendi; mutlak dizin doğrulama, gerçek yol
  çözümleme ve proje kökü dışına çıkan yolların reddi testlerle doğrulandı.
- Gömülü varsayılan `en-US` locale kaynağı için servis iskeleti eklendi; diğer
  dillerin harici language pack olarak geleceği karar korunuyor.
- Faz 2 kapsamında Project, Provider, Finding, Job, Run, Cloud API ve Language
  Pack Zod sözleşmeleri eklendi; provider adapter arayüzü, protocol/locale/timeout
  sabitleri, IPC şema haritası ve state machine geçişleri tanımlandı.
- Paylaşılan sözleşmeler için fixture tabanlı birim testleri ve `shared/` import
  boundary testi eklendi.
- Her faz sonunda `corepack pnpm dev` ile manuel Electron dev açılış kontrolü
  yapılması ve sonucunun faz bitiş raporunda belirtilmesi kuralı `AGENTS.md`
  içine eklendi.
- Faz 1 kapsamında Electron güvenlik temeli tamamlandı; güvenli `BrowserWindow`
  tercihleri, CSP üretimi, navigation guard, Zod doğrulamalı IPC handler deseni
  ve tipli preload `ping` köprüsü eklendi.
- `pnpm dev` açılışı düzeltildi; `ELECTRON_RUN_AS_NODE` ortam değişkenini temizleyen
  launcher eklendi ve Electron main/preload çıktıları `.cjs` olarak üretilecek
  şekilde yapılandırıldı.
- CSP, navigation guard, IPC şeması ve pencere güvenlik tercihleri için regresyon
  testleri eklendi.
- Varsayılan `en-US` dilinin uygulama içinde çalışması ve diğer dillerin imzalı,
  JSON tabanlı `.fplang` paketleriyle yüklenmesi yönünde çoklu dil mimari kararı
  belgelendi.
- ForgePilot deposu için kök `AGENTS.md` eklendi; faz başlamadan önce plan raporu
  ve kullanıcı onayı, faz bitiminde sonuç raporu ve sonraki faza geçiş için tekrar
  onay zorunluluğu belgelendi.
- ForgePilot için pnpm workspace tabanlı Electron, Vite, React ve TypeScript uygulama iskeleti eklendi.
- Main, preload ve renderer girişleri oluşturularak boş ama build edilebilir masaüstü istemci temeli kuruldu.
- Strict TypeScript, ESLint, Prettier ve Vitest doğrulama hattı yapılandırıldı.
- Windows, macOS ve Linux üzerinde typecheck, lint, format ve test çalıştıran GitHub Actions CI eklendi.
- Geliştirme komutları `docs/DEVELOPMENT.md` içinde belgelendi ve Faz 0 görev kaydı tamamlandı.

## 2026-08-13

- Added AI Factory Cloud API client foundation with HTTPS-only enforcement and localhost dev exception.
- Introduced Electron safeStorage-based credential store for secure token persistence.
- Added job service orchestrating handshake, workflow, job request, task execution, result submission, and findings sync flows.
- Added local mock cloud server with `dev:mock-cloud` script, supporting handshake, workflow, job, heartbeat, result, fail, and findings endpoints.
- Added renderer Cloud Run panel and job store for running cloud jobs via selected provider/model from the UI.

- Added "Run Provider" action to the task runner panel for executing real provider CLIs with selected model and instructions
- Refactored task store to handle echo-fixture and provider execution modes with dedicated methods
- Preserved the echo fixture as "Test Echo" for quick verification without provider calls
- Added test coverage verifying provider mode passes the selected model to the process manager

- Added Settings page with provider and model selection for Claude Code and Codex
- Persisted user preferences to `userData/settings.json` via new IPC handlers
- Updated task runner to use selected provider and model from settings
- Added model parameter support to task execution commands for both providers
- Added comprehensive tests for settings IPC handlers and repository persistence

- Added secure `spawn`-based process manager that restricts execution to the project root, disables shell usage, and passes only allowlisted environment variables.
- Implemented task execution service with `tasks:start`/`tasks:stop` IPC handlers, streaming stdout/stderr and exit events to the renderer via typed push channels.
- Added manual task fixture panel with `Run Echo` functionality that validates the process lifecycle without invoking an AI provider.
- Introduced settings repository with schema validation for persisting application settings.
- Added preload API for task subscriptions and settings management, enabling renderer communication with the new IPC channels.

- Added local project management with native folder selection, persistent storage in `userData/projects.json`, and typed IPC/preload APIs for listing, adding, removing, and opening projects.
- Introduced a new Projects screen in the renderer with a Zustand-based store, displaying project lists, active state, and status/error messages.
- Implemented `pathGuard` for absolute path validation and prevention of access outside the selected project root, covered by tests.
- Fixed development CSP to allow Vite's inline preamble only in dev mode, preventing white screens while keeping production `script-src 'self'` strict.
- Made DevTools opening optional via the `FORGEPILOT_OPEN_DEVTOOLS` environment variable to avoid terminal noise during normal development.

- Fixed `pnpm dev` startup by adding a launcher that removes `ELECTRON_RUN_AS_NODE` from the child process environment, ensuring Electron opens as a desktop app.
- Pinned Electron, Electron-Vite, and Vite to compatible versions to resolve runtime and build incompatibilities.
- Configured main and preload build outputs to use `.cjs` format for correct Electron runtime loading.
- Updated the main entry point in `package.json` to reference the new `.cjs` output file.
- Added `electron` to pnpm's allowed build dependencies to ensure proper native module installation.

- Added DESIGN.md as the authoritative technical design document covering architecture, component diagrams, state machines, and cloud API contracts.
- Expanded BUILD_PLAN.md with new architectural decisions for extended provider adapter methods, heartbeat-based job contracts, and version negotiation.
- Added implementation details for environment checks, orphan process reaping, and run state machine management across multiple phases.
- Introduced crash recovery and offline/degraded mode handling specifications with clear server authority rules.
- Defined SQLite schema evolution with checkpoint columns and findings cache, ensuring job instruction bodies are never persisted to disk.

- Added a comprehensive, phased build plan for ForgePilot, outlining the full development roadmap from repository scaffolding to production-ready application.
- Established key architectural decisions, including package management, build tooling, state management, and security protocols, to guide future development.
- Defined nine sequential development phases with clear dependencies, implementation steps, and completion criteria for each stage.
- Documented critical security constraints, such as the thin-client model, credential storage via safeStorage, and strict IPC validation patterns.
- Outlined the provider adapter interface and process execution strategy for integrating with Claude Code and Codex CLI tools.
- Renamed the project readme from `README` to `README.md` so GitHub renders it as the repository overview.
- Added comprehensive README documenting ForgePilot's architecture, provider model, and security principles.
- Defined the open-source vs. server-side component boundary for the desktop client.
- Outlined the development stack, repository structure, and contribution guidelines.
- Established transparency and privacy requirements for local execution and data handling.
- Documented the server-driven workflow design and provider-independent adapter architecture.
