# Provider Contract Doğrulama Hatası

Durum: done

## Özet

`010-Startup` semantic provider çalıştırması Claude Code'a desteklenmeyen
`--json-schema` argümanını geçiriyordu. Bu durum provider process'in non-zero
çıkmasına neden olabiliyor, ForgePilot ise kullanıcıya gerçek stderr yerine genel
contract fail mesajı gösteriyordu.

## Değişiklikler

- Claude Code adapter'ından desteklenmeyen `--json-schema` flag'i kaldırıldı.
- Semantic provider çıktısı ForgePilot içinde cloud directive'in `outputSchema`
  alanına göre lokal doğrulanır hale getirildi.
- Provider process başarısız olduğunda stderr, stderr yoksa stdout özeti stage
  hata mesajına taşındı.
- Contract validation, Claude adapter argümanları ve stage failure mesajı için
  hedefli Vitest testleri eklendi.

## Doğrulama

Çalıştırıldı ve geçti:

- `corepack pnpm vitest run tests/main/claudeCodeAdapter.test.ts tests/services/jsonSchemaContractValidator.test.ts tests/services/stageExecutionServiceContract.test.ts`

Çalıştırıldı ancak repo genelindeki bu görevden bağımsız eski test fixture
uyumsuzlukları nedeniyle geçmedi:

- `corepack pnpm typecheck`
