# Dev CSP Beyaz Ekran Düzeltmesi

Durum: done

## Kapsam

Geliştirme modunda Vite React preamble inline script'i CSP tarafından
engellendiği için Electron penceresi açılıyor ama renderer beyaz kalıyordu.

## Tamamlananlar

- Development CSP içinde `script-src 'self' 'unsafe-inline'` yalnızca dev server
  açıkken kullanılacak şekilde eklendi.
- Production CSP sıkı `script-src 'self'` davranışını koruyor.
- `src/renderer/index.html` içindeki sabit meta CSP kaldırıldı; CSP artık tek
  kaynak olarak main process tarafından ortama göre uygulanıyor.
- CSP testi development davranışını kapsayacak şekilde güncellendi.

## Doğrulama

- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm format:check`
- `corepack pnpm test`
- `corepack pnpm build`
- `corepack pnpm dev`
