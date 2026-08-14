# Real Time Job Progress

Durum: done

## Ozet

Dashboard progress bar ve Activity listesi tahmini zamanlayicilardan gercek job
olaylarina tasindi.

## Degisiklikler

- `jobs:progress` push kanali ve preload aboneligi eklendi.
- `JobService`, handshake, workflow, local exe joblari ve LLM dogrulama
  adimlarinda progress olayi yayiyor.
- Renderer job store artik yalnizca gelen progress olaylarini listeye ekliyor.
- `waiting_for_input` durumunda progress mevcut ara noktada kaliyor; sonraki
  joblar calismadan ekranda tamamlanmis gibi gosterilmiyor.
- Uzun LLM bekleme adimlari icin progress bar'a hareketli canli geri bildirim
  eklendi ve Activity listesi output paneline binmeyecek sekilde kaydirilabilir
  hale getirildi.
- Activity listesi `stepId` bazli duruma cevrildi; ayni is devam ederken mevcut
  satir guncelleniyor, yeni satir yalnizca gercek yeni is basladiginda aciliyor.

## Dogrulama

- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm format:check`
- `corepack pnpm test`
- `corepack pnpm build`
