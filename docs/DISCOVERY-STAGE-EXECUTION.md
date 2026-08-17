# Discovery Stage Seçimi ve Gereksinim UI'sı

ForgePilot, `020-Discovery` substage listesini ve dependency bilgisini proje içindeki:

`/.ai-factory/020-Discovery/STAGE-EXECUTION-MANIFEST.json`

dosyasından okur. Desktop istemcisi Dxx dependency ilişkilerini hard-code etmez.

## Kullanıcı akışı

Bir Discovery substage kartına tıklamak stage'i otomatik başlatmaz. Önce stage ayrıntısı ve requirements görünür.

- Stage `available` ve tüm HARD gereksinimler `Satisfied` ise **Start stage** aktif olur.
- HARD gereksinim eksikse hedef stage başlatılamaz ve **Run requirement** gösterilir.
- **Run requirement** seçildiğinde ForgePilot dependency'nin kendi HARD gereksinimlerini de kontrol eder ve recursive olarak ilk çalıştırılabilir prerequisite stage'i başlatır.
- SOFT dependency eksikliği hedef stage'i bloke etmez.
- Stage manifestte tanımlı fakat paket veya workflow-server execution desteği hazır değilse stage kartı görünür kalır ve **Not Ready** gösterir.

## Availability

Bir Discovery stage'in gerçekten çalıştırılabilir sayılması için iki koşul birlikte gerekir:

1. Manifestte `implementation_status: "available"` olmalı ve stage klasörü projede bulunmalı.
2. Workflow server aynı `stage.id` için executable stage/directive yüzeyi sunmalı.

Böylece yalnızca klasörün bulunması stage'in yanlışlıkla çalıştırılabilir kabul edilmesine yol açmaz.

## Güvenlik / enforcement

Renderer butonları tek enforcement noktası değildir. `JobService.runOnce()` da:

- `availability === "not_ready"` stage'i reddeder.
- Satisfied olmayan HARD dependency bulunan stage'i reddeder.

Bu nedenle IPC üzerinden doğrudan çağrı UI kuralını bypass edemez.

## Mevcut durum

Mevcut 020-Discovery paketinde:

- D05 Project Overview: **available**
- D10 Architecture: **available**
- D15–D70: katalogda görünür, ancak stage paketleri henüz tamamlanmadığı için **not_ready**

Yeni bir stage tamamlandığında ForgePilot dependency kodu değiştirilmez. İlgili stage paketi ve workflow server execution desteği hazırlanır; ardından `STAGE-EXECUTION-MANIFEST.json` içindeki availability/dependency contractı güncellenir.
