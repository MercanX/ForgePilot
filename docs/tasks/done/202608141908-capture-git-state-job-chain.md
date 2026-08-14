# Capture git state job chain

Durum: Done

## Kapsam

`010-Startup` akisi Job 4 `capture_git_state` adimina genisletildi. Job 3
dogrulamasi `ok: true` dondurur ve `place_inputs.status` `ready` olursa exe,
RULE-A05 algoritmasina gore secili run klasorune `git-head.txt`,
`git-status.txt` ve `working-tree.patch` dosyalarini yazar.

Proje git deposuysa dosyalar gercek `git rev-parse HEAD`, `git status --short`
ve `git diff --binary` ciktilariyla doldurulur. Git yoksa, proje repo degilse
veya komutlardan biri hata verirse uc dosyanin tamamına `NO GIT REPOSITORY`
yazilir ve `has_git: false` mesru sonuc olarak doner.

Mock cloud, Job 4 icin
`C:\Github\aiFactory\.ai-factory\010-Startup\rules\050-capture_git_state.rules.md`
dosyasini runtime'da okuyarak LLM dogrulama prompt'unu olusturur.

## Dogrulama

- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm format:check`
- `corepack pnpm test`
- `corepack pnpm build`
