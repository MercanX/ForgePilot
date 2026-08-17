# Discovery stage catalog + requirements UI

## Tamamlanan iş

- 020-Discovery manifestinden tüm D05–D70 substages okunuyor.
- Stage availability ve HARD/SOFT requirements workflow modeline ekleniyor.
- D05/D10 mevcut executable stage olarak görünür.
- Henüz yazılmamış stage'ler `Not Ready` olarak görünür.
- Eksik HARD dependency için `Run requirement` aksiyonu eklendi.
- Recursive prerequisite seçimi ve cycle-safe UI traversal eklendi.
- Backend `runOnce` availability/HARD requirement guard eklendi.
- Manifest parser duplicate/unknown/self/cyclic HARD dependency'leri reddediyor.
- Tekrar üretilebilir `test:stage-catalog` verifier eklendi.
