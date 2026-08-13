# Faz 2 Paylaşılan Sözleşmeler

Durum: done

## Kapsam

ForgePilot'in sonraki fazlarda kullanacağı ortak veri sözleşmeleri, provider
adapter arayüzü, state machine tipleri, IPC şema haritası, protocol sabitleri ve
language pack manifest şeması eklendi.

## Tamamlananlar

- Project, provider, finding, job, run, cloud API ve language pack Zod şemaları
  oluşturuldu.
- Provider id, locale, timeout ve protocol/capability sabitleri eklendi.
- `ProviderAdapter` davranışsal TypeScript arayüzü tanımlandı.
- Run, stage ve job durum geçişleri merkezi state machine tipleriyle modellendi.
- IPC şema haritası projects, providers, jobs, logs ve localization alanlarına
  genişletildi.
- Language pack mimarisine uygun `LanguagePackManifest` ve çeviri dosyası
  şemaları eklendi; gömülü `en-US` paket olarak yüklenemez kuralı doğrulandı.
- `shared/` katmanının `main`, `renderer` veya `services` import etmemesi için
  import-boundary testi eklendi.
- Geçerli/geçersiz fixture testleriyle sözleşme yüzeyi doğrulandı.

## Doğrulama

- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm format:check`
- `corepack pnpm test`
- `corepack pnpm build`
- `corepack pnpm dev`
