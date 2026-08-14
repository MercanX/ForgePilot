# Startup Input File Actions

Durum: done

## Ozet

Job 3 `waiting_for_input` sonucunda kullanicinin `SCOPE.md` ve `BASELINE.md`
dosyalarini dogrudan Dashboard uzerinden acabilmesi eklendi.

## Degisiklikler

- `startup:open-input-file` IPC kanali ve preload API metodu eklendi.
- Main process, yalnizca `SCOPE.md` ve `BASELINE.md` dosyalarini kabul edip
  hedef path'in secili proje kokunun icinde kaldigini dogruluyor.
- Dashboard, `waiting_for_input` durumunda iki dosya acma butonu ve kisa durum
  mesaji gosteriyor.
- IPC sozlesmesi ve handler davranisi testlerle kapsandi.

## Dogrulama

- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm format:check`
- `corepack pnpm test`
- `corepack pnpm build`
