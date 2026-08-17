# Discovery Stage Execution

ForgePilot, `020-Discovery` runtime paketini seçili yazılım projesinin içinde aramaz. Stage catalog ve HARD/SOFT dependency sözleşmesinin authority'si AI Factory runtime paketidir. Yerel geliştirme düzeninde varsayılan konum:

```text
C:\\Github\\aiFactory\\.ai-factory\\020-Discovery\\STAGE-EXECUTION-MANIFEST.json
```

`FORGEPILOT_DISCOVERY_MANIFEST` environment variable ile workflow server farklı bir runtime manifest konumuna yönlendirilebilir. Workflow server manifesti yükler ve stage listesini `/workflows/current` cevabında ForgePilot desktop'a yayınlar. Desktop seçili proje altında runtime manifest aramaz.

## Runtime ve project state ayrımı

AI Factory runtime tarafı şunların authority'sidir:

- D05-D70 stage catalog,
- stage açıklamaları,
- `available` / `not_ready` implementation durumu,
- HARD/SOFT dependency contract,
- executable provider/local directives,
- prompt ve output schema dosyaları.

Seçili proje tarafı ise yalnız o projeye ait state/artifact authority'sidir; örneğin Startup seal, audit snapshot, stage outputs ve ForgePilot local state. Runtime stage paketinin her hedef projeye kopyalanması gerekmez.

## UI davranışı

Bir stage seçildiğinde audit otomatik başlamaz. ForgePilot server'ın yayınladığı metadata üzerinden description ve requirements gösterir.

- Stage executable ve bütün HARD gereksinimler satisfied ise `Start stage`.
- HARD dependency eksik ama runnable ise `Run requirement`.
- SOFT dependency eksikse hedef stage bloklanmaz.
- Stage katalogda var ama runtime package veya execution directive hazır değilse `Not Ready`.

`Run requirement` renderer tarafında recursive olarak en yakın çalıştırılabilir prerequisite'i bulur. Backend `runOnce` aynı availability/HARD kurallarını tekrar doğrular; doğrudan IPC çağrısı UI guard'ını bypass edemez.

## Stage ekleme

Yeni bir stage tamamlandığında ForgePilot'a Dxx ilişkisi hard-code edilmez. İlgili stage paketi AI Factory runtime'a eklenir, workflow server execution directive'i hazırlanır ve `STAGE-EXECUTION-MANIFEST.json` availability/dependency contractı güncellenir. Desktop katalog bilgisini bir sonraki workflow yüklemesinde server'dan alır.
