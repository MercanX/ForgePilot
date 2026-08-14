# Startup job rule execution

Durum: Done

## Kapsam

`010-Startup` stage baslatildiginda ForgePilot artik provider'a gitmeden once
yerel exe isini yapar: aktif proje kokunde `.ai-factory/` klasorunu garanti eder
ve `.ai-factory/factory.config.yaml` dosyasini RULE-A02 sozlesmesine gore
olusturur veya okur.

Mock cloud job istegi, exe sonucunu `localExecution` olarak alir ve
`C:\Github\aiFactory\.ai-factory\010-Startup\rules\010-check_factory.rules.md`
ile
`C:\Github\aiFactory\.ai-factory\010-Startup\rules\020-read_config.rules.md`
iceriklerini LLM dogrulama prompt'una yerlestirir.

## Dogrulama

- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm format:check`
- `corepack pnpm test`
- `corepack pnpm build`
