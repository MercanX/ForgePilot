# Faz 4 Sağlayıcı Tespiti

Durum: done

## Kapsam

ForgePilot'in Claude Code ve Codex CLI kurulumlarını güvenli şekilde tespit
edebilmesi, sonuçları tipli IPC/preload hattından renderer'a taşıması ve kullanıcıya
provider durum paneli göstermesi sağlandı.

## Tamamlananlar

- `commandRunner` eklendi; komutlar `execFile` ile, shell açmadan ve timeout ile
  çalıştırılıyor.
- `CliProviderAdapter` temel sınıfı eklendi; kurulum tespiti, versiyon okuma,
  auth durum sinyali ve Faz 5'e bırakılan task metotları tanımlandı.
- `claude-code` ve `codex` adaptörleri eklendi.
- `ProviderRegistry` ile provider list/detect/refresh akışı merkezi hale getirildi.
- `providers:list`, `providers:detect` ve `providers:refresh` IPC handler'ları
  eklendi.
- Preload içine `window.forgepilot.providers.*` tipli API'si eklendi.
- Renderer tarafında Zustand tabanlı provider store'u ve Environment Check provider
  paneli eklendi.
- Git kurulum/sürüm tespiti için `gitDetect` temel modülü eklendi.
- Provider adapter, registry, IPC ve Git tespiti testleri eklendi.

## Doğrulama

- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm format:check`
- `corepack pnpm test`
- `corepack pnpm build`
- `corepack pnpm dev`
