# Place inputs job chain

Durum: Done

## Kapsam

`010-Startup` akisi Job 3 `place_inputs` adimina genisletildi. Job 2
dogrulamasi `ok: true` dondurur ve karar `already_sealed` degilse exe,
RULE-A04 algoritmasina gore secili run klasorune `SCOPE.md` ve `BASELINE.md`
dosyalarini yerlestirir.

Proje kokunde onayli dosyalar varsa run klasorune kopyalanir. `BASELINE.md`
yoksa sabit tr-TR template yazilir. `SCOPE.md` yoksa proje kokundeki ust duzey
dosya/klasorler taranarak Include/Exclude listeleri mekanik olarak doldurulmus
tr-TR template yazilir; `.git`, `.ai-factory`, `.ai-factory-runs`, `.claude`,
`node_modules`, `vendor` ve `.gitignore` desenleri Exclude tarafina alinir.
Template marker'i kalan veya bos dosyalar `waiting_for_input` sonucunu uretir
ve bu durum ihlal sayilmaz.

Mock cloud, Job 3 icin
`C:\Github\aiFactory\.ai-factory\010-Startup\rules\040-place_inputs.rules.md`
dosyasini runtime'da okuyarak LLM dogrulama prompt'unu olusturur.

## Dogrulama

- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm format:check`
- `corepack pnpm test`
- `corepack pnpm build`
