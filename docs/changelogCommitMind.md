# Changelog CommitMind

## 2026-08-17 — Discovery stage catalog ve dependency UI

ForgePilot Discovery stage görünürlüğü server stage listesinden bağımsız olarak proje içindeki `STAGE-EXECUTION-MANIFEST.json` ile zenginleştirildi. Tüm D05–D70 substages UI'da görünür hale getirildi; executable olmayan stage'ler `Not Ready`, eksik HARD dependency'ler `Run requirement`, hazır stage'ler `Start stage` davranışı aldı. Backend execution guard ve manifest cycle validation eklendi.
