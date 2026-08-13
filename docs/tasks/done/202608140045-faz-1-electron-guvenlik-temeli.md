# Faz 1 Electron Güvenlik Temeli

Durum: done

## Kapsam

ForgePilot için açılabilir Electron kabuğu, güvenli renderer sınırları,
Content-Security-Policy, navigation guard, preload API yüzeyi ve Zod doğrulamalı
IPC handler deseni tamamlandı.

## Tamamlananlar

- Main bootstrap, pencere oluşturma ve güvenlik davranışları ayrıldı.
- `BrowserWindow` güvenlik tercihleri merkezi hale getirildi.
- Production ve development için kontrollü CSP üretimi eklendi.
- Dış navigasyon ve yeni pencere açma davranışı engellendi.
- Preload API yüzeyi `window.forgepilot.app.ping()` ile tipli hale getirildi.
- IPC handler'larında request/response Zod doğrulaması ve kontrollü hata sınıfı
  eklendi.
- Environment check ve orphan reaper modülleri Faz 1 seviyesinde iskelet olarak
  bırakıldı.
- CSP, navigation guard, IPC şeması ve pencere güvenlik tercihleri için testler
  eklendi.

## Doğrulama

- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm format:check`
- `corepack pnpm test`
- `corepack pnpm build`
