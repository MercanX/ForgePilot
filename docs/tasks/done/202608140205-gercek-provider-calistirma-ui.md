# Gercek Provider Calistirma UI

Durum: Tamamlandi

## Kapsam

Faz 6'ya gecmeden once manuel task panelinden secili provider'a gercek soru
gonderme akisi eklendi.

## Yapilanlar

- `Run Provider` butonu eklendi ve `tasks:start` istegi `mode: "provider"` ile
  gonderilecek sekilde baglandi.
- Eski echo fixture araci `Test Echo` olarak korundu.
- Task store, fixture ve gercek provider calistirmayi ayri metodlarla yonetir
  hale getirildi.
- Gercek provider modunun secili model argumanini process manager'a tasidigi
  testle dogrulandi.

## Dogrulama

- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm format:check`
- `corepack pnpm test`
- `corepack pnpm build`
- `corepack pnpm dev` manuel Electron acilis kontrolu
