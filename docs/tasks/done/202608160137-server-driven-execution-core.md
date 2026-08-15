# Sunucu Güdümlü Çalıştırma Çekirdeği

Durum: done

## Özet

ForgePilot desktop içinde stage adına göre büyüyen Startup/Discovery orkestrasyonu
kaldırıldı. Desktop artık Cloud'dan yalnızca sıradaki tek execution directive'ini
alıyor ve generic local/provider executor olarak çalışıyor.

## Değişiklikler

- Protocol v2 için `local | provider | terminal` execution directive şemaları eklendi.
- `jobService.ts` stage-specific branch'lerden temizlendi; workflow state yalnız Cloud'dan okunuyor.
- Local deterministic işler `localOperationRegistry` üzerinden capability adıyla çalışıyor.
- Stage completion kararı mock cloud state-machine'e taşındı; `/jobs/{id}/result` stage tamamlayamıyor.
- Küçük local directive sonuçları crash recovery için execution journal'da idempotent cache'leniyor.
- Provider CLI komut/argüman üretimi adaptörlere taşındı.
- Cloud task instruction body'nin `.ai-factory/.tmp/prompt-*.md` olarak diske yazılması kaldırıldı; stdin kullanılıyor.
- Hızlı process output/exit event kaybı için process manager replay tamponu eklendi.
- Renderer final durumu `stageOutcome` alanından okuyor.
- Startup + Discovery completion authority için bağımsız Node.js protocol regression testi eklendi.
- Vitest için execution schema, journal, local-operation registry ve provider stdin contract testleri eklendi.

## Doğrulama

Çalıştırıldı ve geçti:

- `node --check tools/mock-cloud/mock-cloud.cjs`
- `node --check tools/verify-execution-protocol.cjs`
- `node tools/verify-execution-protocol.cjs`
- TypeScript `transpileModule` ile `src/` + `tests/` içindeki 73 `.ts/.tsx` dosyasında syntax diagnostics kontrolü (`0` hata)

Bu teslim ortamındaki ZIP `node_modules` içermediği ve registry erişimi olmadığı için
şunlar tam olarak koşturulamadı. `tsc --noEmit` denemesi `vitest/globals` type definition
bulunamadığı noktada durdu:

- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm format:check`
- `corepack pnpm test`
- `corepack pnpm build`
- `corepack pnpm dev`

Tam dependency kurulumu olan geliştirme makinesinde bu komutlar merge öncesi yeniden
çalıştırılmalıdır.

Ayrıca yüklenen ZIP `.git` geçmişi içermediği için `git status` / `git log` doğrulaması yapılamadı.
