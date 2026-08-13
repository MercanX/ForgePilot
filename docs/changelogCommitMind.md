# Changelog CommitMind

## 2026-08-14

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
