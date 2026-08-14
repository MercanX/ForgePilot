# Complete Startup Job Chain

Durum: done

## Ozet

`C:\Github\aiFactory\.ai-factory\010-Startup\JOB.md` icindeki kalan Job 5,
Job 6 ve Job 7 akisa baglandi.

## Degisiklikler

- RULE-A06 algoritmasiyla `SOURCE_MANIFEST.csv` uretiliyor.
- RULE-A07 algoritmasiyla `FACTORY_MANIFEST.csv` uretiliyor.
- RULE-A08 algoritmasiyla `PRE_RUN_MANIFEST.json` ve `RUN_SEAL.json`
  uretiliyor.
- `JobService`, Job 4 LLM dogrulamasi gecmeden Job 5'e gecmiyor; Job 5-7 de
  ayni exe + LLM dogrulama zincirine baglandi.
- Mock cloud, `060`, `070` ve `080` rule dosyalarini runtime'da okuyup ilgili
  LLM dogrulama prompt'unu olusturuyor.
- Dashboard final manifest ve seal sonuclarini gosterecek sekilde genisletildi.

## Dogrulama

- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm format:check`
- `corepack pnpm test`
- `corepack pnpm build`
