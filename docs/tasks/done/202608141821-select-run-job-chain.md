# Select run job chain

Durum: Done

## Kapsam

`010-Startup` akisi icinde Job 1 LLM dogrulamasi `ok: true` dondurdugunde
ForgePilot artik Job 2 `select_run` adimina gecer. Exe tarafi RULE-A03
algoritmasina gore `.ai-factory-runs/` klasorunu ve `.gitignore` dosyasini
garanti eder, en son kosuyu bulur ve `new`, `continue` veya `already_sealed`
kararini uretir.

Mock cloud, Job 2 icin
`C:\Github\aiFactory\.ai-factory\010-Startup\rules\030-select_run.rules.md`
dosyasini runtime'da okuyarak LLM dogrulama prompt'unu olusturur.

## Dogrulama

- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm format:check`
- `corepack pnpm test`
- `corepack pnpm build`
