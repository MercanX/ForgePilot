# Dashboard stage startup flow

Durum: Done

## Kapsam

Proje listesindeki `Open` aksiyonu artik kullaniciyi temiz bir proje Dashboard
sayfasina tasir. Dashboard, workflow stage listesini `jobs:workflow` IPC yuzeyi
uzerinden mock cloud'dan alir ve ilk hazir stage olan `010-Startup` icin
calistirma butonu sunar.

## Dogrulama

- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm format:check`
- `corepack pnpm test`
- `corepack pnpm build`
- `corepack pnpm dev` ile ForgePilot penceresi acildi; kontrol sonrasi dev
  sureci kapatildi.
