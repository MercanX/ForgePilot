# Provider Windows Shim Seçimi

Durum: done

## Kapsam

Codex kurulu olduğu halde provider kartında `Installed` rozeti yanında
`CLI was not detected on PATH.` mesajı görünüyordu.

## Neden

Windows'ta `where.exe codex` birden fazla sonuç döndürüyor. İlk sonuç uzantısız
npm shim'i olabiliyor; bu dosya kurulum sinyali veriyor ama `execFile` ile versiyon
okuma için güvenilir çalıştırılabilir aday değil.

## Tamamlananlar

- Windows'ta `.exe` adayları uzantısız/npm shim yollarına göre önceliklendirildi.
- Provider kartı, CLI kurulu ama versiyon çıktısı yoksa artık `not detected`
  yerine `CLI detected. Version output is unavailable.` mesajı gösteriyor.
- Aday seçimi testle sabitlendi.

## Doğrulama

- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm format:check`
- `corepack pnpm test`
- `corepack pnpm build`
- `corepack pnpm dev`
