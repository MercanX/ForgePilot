# DevTools Otomatik Açılış Düzeltmesi

Durum: done

## Kapsam

Geliştirme modunda Electron penceresi açılırken Chromium DevTools'un otomatik
açılması, terminale uygulama dışı `devtools://` uyarıları basılmasına neden
oluyordu. Normal `corepack pnpm dev` çıktısı temizlenecek şekilde DevTools
otomatik açılışı opsiyonel hale getirildi.

## Tamamlananlar

- `openDevTools` davranışı `MainWindowOptions` içine alındı.
- `FORGEPILOT_OPEN_DEVTOOLS=1` verilmediği sürece DevTools otomatik açılmayacak
  hale getirildi.
- DevTools'u gerektiğinde açma komutu `docs/DEVELOPMENT.md` içinde belgelendi.

## Doğrulama

- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm format:check`
- `corepack pnpm test`
- `corepack pnpm build`
- `corepack pnpm dev`
