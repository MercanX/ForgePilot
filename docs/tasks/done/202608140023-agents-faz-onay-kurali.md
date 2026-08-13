# AGENTS Faz Onay Kuralı

Durum: done

## Kapsam

ForgePilot deposu için kök `AGENTS.md` dosyası oluşturuldu. Faz bazlı çalışma
akışında her fazdan önce plan raporu, kullanıcı onayı, faz sonunda bitiş raporu
ve sonraki faza geçmeden tekrar onay zorunluluğu belgelendi.

## Tamamlananlar

- Repoya özel mimari ve güvenlik ilkeleri yazıldı.
- Zorunlu başlangıç kontrolleri belirlendi.
- Faz başlangıç ve bitiş raporu formatları tanımlandı.
- Kullanıcı onayı olmadan sonraki faza geçilmemesi kuralı kalıcı hale getirildi.

## Doğrulama

- `corepack pnpm format:check`
