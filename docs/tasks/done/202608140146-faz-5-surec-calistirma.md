# Faz 5 Süreç Çalıştırma

Durum: done

## Kapsam

ForgePilot'in seçili proje kökü içinde güvenli child process başlatabilmesi,
stdout/stderr ve exit olaylarını renderer'a aktarabilmesi ve manuel bir fixture
göreviyle süreç yaşam döngüsünü doğrulayabilmesi sağlandı.

## Tamamlananlar

- `processManager` eklendi; `spawn` kullanır, `shell: false` çalışır, cwd'yi
  `pathGuard` ile proje köküne sınırlar ve environment değerlerini allowlist ile
  aktarır.
- `taskExecutionService` eklendi; provider kurulumunu kontrol eder, echo fixture
  veya provider çalışma profili oluşturur, output/exit olaylarını normalize eder.
- `tasks:start`, `tasks:stop`, `tasks:output` ve `tasks:exit` kanal sözleşmeleri
  eklendi.
- Preload içine `window.forgepilot.tasks.*` API'si ve `onOutput`/`onExit`
  abonelikleri eklendi.
- Renderer'a `Manual Task Fixture` paneli eklendi; `Run Echo` gerçek child process
  çalıştırır, `Stop` süreci sonlandırır ve çıktı panelde canlı görünür.
- Process manager ve task execution service davranışları test edildi.

## Doğrulama

- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm format:check`
- `corepack pnpm test`
- `corepack pnpm build`
- `corepack pnpm dev`
