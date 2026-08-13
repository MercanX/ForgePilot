# Changelog CommitMind

## 2026-08-14

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
