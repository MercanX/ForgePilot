# Faz 6 Cloud API Istemcisi

Durum: Tamamlandi

## Kapsam

AI Factory Cloud siniri icin mock'lanabilir API istemcisi, job calistirma
servisi ve gelistirme mock cloud server'i eklendi.

## Yapilanlar

- Cloud status ve run-once IPC sozlesmeleri eklendi.
- HTTPS-only `httpClient` eklendi; `http://localhost` yalnizca dev mock cloud
  icin kabul edilir.
- Electron `safeStorage` tabanli credential store eklendi.
- `jobService`, handshake, workflow, job request, task get, provider execution,
  result submit, fail ve findings sync akisini baglar hale getirildi.
- `tools/mock-cloud/mock-cloud.cjs` ve `corepack pnpm dev:mock-cloud` komutu
  eklendi.
- Renderer'a `Mock Cloud Run` paneli eklendi; secili proje/provider/model ile
  mock cloud'dan gelen task gercek provider hattinda calistirilabilir.
- Hizli process cikislarinda output kacmasin diye `processManager` input yazimini
  listener baglama sonrasina aldi.

## Dogrulama

- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm format:check`
- `corepack pnpm test`
- `corepack pnpm build`
- `corepack pnpm dev`
