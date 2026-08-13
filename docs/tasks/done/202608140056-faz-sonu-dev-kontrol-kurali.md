# Faz Sonu Dev Kontrol Kuralı

Durum: done

## Kapsam

Her faz sonunda `corepack pnpm dev` ile manuel dev açılış kontrolü yapılması ve
sonucun faz bitiş raporunda açıkça yazılması kuralı `AGENTS.md` içine eklendi.

## Tamamlananlar

- Faz bitiş doğrulamalarına manuel dev açılış kontrolü eklendi.
- Dev raporunda Electron penceresi, pencere başlığı, hata çıktısı ve süreç durumu
  bilgisinin yazılması zorunlu hale getirildi.

## Doğrulama

- `corepack pnpm format:check`
