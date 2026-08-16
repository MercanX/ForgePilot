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
- Ana pencere açılışta sabit `1440x900` boyutunda açılır ve kullanıcı tarafından
  yeniden boyutlandırılamaz hale getirildi; native menü çubuğu korunur.
- Dashboard iki kolon hizasına alındı: `Project` kartı ve `Stages` paneli aynı
  sol kolon genişliğini, `Cloud/Provider/Model` kartları ve `Stage` detay paneli
  aynı sağ kolon başlangıç/bitiş hizasını kullanır.
- `tools/restart-dev.ps1` eklendi; Electron, renderer dev server ve mock cloud
  süreçlerini kapatıp temiz mock state ile yeniden başlatır.

## Doğrulama

Çalıştırıldı ve geçti:

- `corepack pnpm exec eslint src/renderer/src/App.tsx src/renderer/src/pages/DashboardPage.tsx src/renderer/src/pages/SettingsPage.tsx src/services/jobs/stageExecutionService.ts`
- `corepack pnpm exec eslint src/renderer/src/pages/DashboardPage.tsx src/renderer/src/pages/SettingsPage.tsx`
- `corepack pnpm exec eslint src/main/app/window.ts src/renderer/src/pages/DashboardPage.tsx`
- `corepack pnpm exec eslint src/main/app/window.ts`
- `corepack pnpm vitest run tests/main/window.test.ts tests/main/security.test.ts`
- PowerShell syntax kontrolü: `[scriptblock]::Create((Get-Content -Raw tools\restart-dev.ps1))`
- `powershell -ExecutionPolicy Bypass -File tools\restart-dev.ps1`

Çalıştırıldı ancak repo genelindeki eski test fixture uyumsuzlukları nedeniyle
geçmedi:

- `corepack pnpm typecheck`
