# Provider Exit Code Düzeltmesi

Durum: done

## Kapsam

Claude Code ve Codex sistemde kurulu olduğu halde provider panelinde `Not installed`
görünüyordu.

## Neden

`execFile` başarılı tamamlandığında `error` boş gelir. `commandRunner`, bu durumda
exit code'u `0` yerine `null` olarak döndürüyordu. `findExecutable` ise `null`
değerini başarısız sonuç gibi yorumlayıp komutu yok sayıyordu.

## Tamamlananlar

- Başarılı `execFile` çağrılarında `exitCode: 0` dönecek şekilde düzeltildi.
- Başarılı komut çalıştırma davranışı testle sabitlendi.

## Doğrulama

- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm format:check`
- `corepack pnpm test`
- `corepack pnpm build`
- `corepack pnpm dev`
