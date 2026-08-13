# Language Pack Mimari Kararı

Durum: done

## Kapsam

ForgePilot'in çoklu dil yaklaşımı için mimari karar belgelendi. Varsayılan dilin
`en-US` olarak uygulamanın içinde gelmesi, uygulamanın dil paketi olmadan
çalışması ve diğer dillerin harici JSON tabanlı language pack olarak yüklenmesi
karara bağlandı.

## Tamamlananlar

- `AGENTS.md` içine çoklu dil ve language pack kuralı eklendi.
- `docs/BUILD_PLAN.md` içine language pack mimari kararı ve faz eşlemeleri eklendi.
- `docs/DESIGN.md` içine `.fplang` paket modeli, doğrulama, fallback ve güvenlik
  kuralları eklendi.
- `README.md` içine language pack davranışı kullanıcı düzeyinde eklendi.
- Renderer HTML varsayılan dili `en` olarak ayarlandı.

## Doğrulama

- `corepack pnpm format:check`
