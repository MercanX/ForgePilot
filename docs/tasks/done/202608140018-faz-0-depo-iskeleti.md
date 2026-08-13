# Faz 0 Depo İskeleti

Durum: done

## Kapsam

ForgePilot için Electron, Vite, React ve TypeScript tabanlı ilk uygulama iskeleti
kuruldu. pnpm workspace, lint, format, test, build ve CI doğrulama hattı eklendi.

## Tamamlananlar

- Kök paket ve workspace yapılandırması oluşturuldu.
- Electron main, preload ve renderer girişleri eklendi.
- TypeScript path alias'ları ve strict derleme ayarları tanımlandı.
- ESLint, Prettier ve Vitest yapılandırıldı.
- GitHub Actions CI matrisi eklendi.
- Geliştirme komutları `docs/DEVELOPMENT.md` içinde belgelendi.

## Doğrulama

- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm format:check`
- `corepack pnpm test`
- `corepack pnpm build`
