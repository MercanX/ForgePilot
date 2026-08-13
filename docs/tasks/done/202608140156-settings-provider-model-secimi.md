# Settings Provider ve Model Seçimi

Durum: done

## Kapsam

Kullanıcının aktif provider'ı ve provider'a bağlı modeli uygulama içinden
seçebilmesi sağlandı.

## Tamamlananlar

- `settings:get` ve `settings:save` IPC/preload hattı eklendi.
- Ayarlar `userData/settings.json` içinde kalıcı saklanıyor.
- Settings ekranı eklendi.
- Aktif provider seçimi Claude Code ve Codex arasında yapılabiliyor.
- Claude Code ve Codex için model tercihleri düzenlenebiliyor.
- Task runner, provider/model bilgisini Settings seçiminden okuyor.
- Echo fixture çıktısına seçili model bilgisi eklendi.

## Doğrulama

- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm format:check`
- `corepack pnpm test`
- `corepack pnpm build`
- `corepack pnpm dev`
