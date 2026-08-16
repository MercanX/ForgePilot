# Dashboard Runtime Özeti ve Settings Provider Alanı

Durum: done

## Özet

Dashboard üzerindeki provider ortam kontrolü Settings sayfasına taşındı. Dashboard
üstündeki proje/cloud/provider bilgileri daha okunur kartlı bir runtime özeti
olarak düzenlendi ve seçili model bilgisi eklendi.

## Değişiklikler

- Global üst bar tekrar eden Cloud/Provider metninden temizlenip preload bridge
  durumuna sadeleştirildi.
- Dashboard runtime özeti Project, Cloud, Provider ve Model kartlarıyla daha
  görünür hale getirildi.
- Bağlı/aktif runtime kartları koyu renkli durum yüzeyleriyle vurgulandı; eksik
  provider/model durumları ayrı uyarı rengiyle gösterildi.
- Provider environment check kartları Settings sayfasına taşındı.
- Settings sayfasına Cloud, Provider ve Model bilgisini gösteren runtime status
  bölümü eklendi.

## Doğrulama

Çalıştırıldı ve geçti:

- `corepack pnpm exec eslint src/renderer/src/App.tsx src/renderer/src/pages/DashboardPage.tsx src/renderer/src/pages/SettingsPage.tsx src/services/jobs/stageExecutionService.ts`
- `corepack pnpm exec eslint src/renderer/src/pages/DashboardPage.tsx src/renderer/src/pages/SettingsPage.tsx`

Çalıştırıldı ancak repo genelindeki eski test fixture uyumsuzlukları nedeniyle
geçmedi:

- `corepack pnpm typecheck`
