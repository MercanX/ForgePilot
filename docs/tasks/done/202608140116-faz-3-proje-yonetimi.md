# Faz 3 Proje Yönetimi

Durum: done

## Kapsam

ForgePilot'in yerel proje klasörlerini seçebilmesi, kalıcı olarak saklayabilmesi
ve renderer içinde ilk gerçek proje yönetimi ekranını gösterebilmesi sağlandı.

## Tamamlananlar

- `pathGuard` ile mutlak dizin doğrulama, gerçek yol çözümleme ve proje kökü dışı
  yol reddi eklendi.
- `projectRepository` ile projeler `userData/projects.json` altında kalıcı hale
  getirildi.
- `projects:list`, `projects:add`, `projects:remove` ve `projects:open` IPC
  handler'ları eklendi.
- Preload yüzeyine `window.forgepilot.projects.*` tipli API'si eklendi.
- Renderer tarafında Zustand tabanlı proje store'u ve Projects ekranı eklendi.
- Kullanıcı klasör seçme dialog'unu iptal ettiğinde `projects:add` normal olarak
  `null` dönecek şekilde sözleşme gerçek davranışla eşitlendi.
- Gömülü varsayılan `en-US` locale kaynağı için ilk servis iskeleti eklendi.
- Path guard, proje repository ve projects IPC davranışları için testler eklendi.

## Doğrulama

- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm format:check`
- `corepack pnpm test`
- `corepack pnpm build`
- `corepack pnpm dev`
