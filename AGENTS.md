# AGENTS.md

Bu dosya ForgePilot deposunda çalışan tüm AI ajanları için bağlayıcı çalışma
kurallarını tanımlar. Depodaki gerçek kod, dokümanlar ve commit geçmişi her zaman
sohbet geçmişinden daha güvenilirdir.

## Dil

- Kullanıcıya verilen tüm açıklamalar Türkçe olmalıdır.
- Doküman güncellemeleri Türkçe yazılmalıdır.
- Kod, dosya adları, komutlar, API adları ve teknik identifier'lar mevcut halleriyle korunmalıdır.

## Repo Özeti

ForgePilot, AI Factory için açık kaynak masaüstü yürütme istemcisidir.

Temel mimari ilkeler:

- Uygulama Electron, Node.js, TypeScript, React, Vite, SQLite ve Zod hattında ilerler.
- ForgePilot ince istemcidir; AI Factory'nin özel agent, rule, skill, workflow, prompt,
  skor veya orkestrasyon mantığı istemciye gömülmez.
- Workflow ve stage listesi sunucu-güdümlüdür; istemci stage isimlerine göre
  hard-code edilmiş kararlar vermemelidir.
- Claude Code ve Codex gibi sağlayıcılar `ProviderAdapter` soyutlaması üzerinden
  yönetilir.
- Renderer tarafı doğrudan `fs`, `child_process`, `process`, SQLite veya cloud
  credential erişimine sahip olmamalıdır.
- IPC yüzeyi preload üzerinden tipli ve isimlendirilmiş metodlarla açılmalıdır;
  genel amaçlı ham `invoke(channel, args)` API'si sızdırılmamalıdır.
- IPC istek ve yanıtları Zod şemalarıyla doğrulanmalıdır.
- Electron güvenlik ayarları baştan korunmalıdır: `contextIsolation: true`,
  `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`.
- Yerel proje sınırı açıkça korunmalıdır; seçili proje kökü dışına dosya erişimi
  engellenmelidir.
- Job talimat gövdeleri diske yazılmamalıdır; yerel DB cache, sunucu ise workflow
  ve findings tarafında source of truth kabul edilir.
- Uygulama multi-language tasarlanmalıdır. Varsayılan dil `en-US` uygulamanın
  içinde bulunmalı ve hiçbir dil paketi yüklenmeden çalışmalıdır. `en-US`
  dışındaki diller harici, doğrulanmış JSON tabanlı language pack olarak
  yüklenmelidir.
- Dil paketleri kod çalıştıramaz; yalnızca JSON çeviri dosyaları ve manifest
  içermelidir. Production build'de imzalı paket zorunlu, dev build'de açıkça
  işaretlenmiş imzasız paket testi mümkün olmalıdır.

## Temel Kaynaklar

Çalışmaya başlamadan önce gerçek durum bu kaynaklardan okunmalıdır:

- `README.md`: ürün vizyonu ve açık kaynak/sunucu tarafı sınırı
- `docs/DESIGN.md`: teknik tasarım için birincil kaynak
- `docs/BUILD_PLAN.md`: faz sırası ve bitti kriterleri
- `docs/DEVELOPMENT.md`: kurulum ve doğrulama komutları
- `docs/changelogCommitMind.md`: tamamlanmış anlamlı değişiklikler
- `docs/tasks/README.md`: görev takip düzeni
- `AGENTS.md`: bu çalışma kuralları

Teknik detaylarda `docs/DESIGN.md`, faz sıralamasında `docs/BUILD_PLAN.md`
önceliklidir.

## Zorunlu Başlangıç Kontrolleri

Her çalışma başlangıcında:

1. `git status --short` çalıştır.
2. Son commitleri `git log --oneline -n 10` ile incele.
3. Bu `AGENTS.md` dosyasını oku.
4. İlgili dokümanları ve kaynak dosyaları oku.
5. Değişiklik yapmadan önce hedef dosyanın gerçekten doğru dosya olduğunu
   koddan ve dokümandan doğrula.

Kullanıcının yaptığı veya başka bir araçtan gelen değişiklikler geri alınmamalıdır.
Kirli worktree normal kabul edilir; yalnızca istenen işle ilgili dosyalara dokun.

## Faz Onay Kapısı

ForgePilot geliştirmesi faz bazlı yürütülür. Ajan hiçbir fazdan diğerine otomatik
geçemez.

### Bir Faza Başlamadan Önce

Yeni bir faza başlamadan önce kullanıcıya kısa bir başlangıç raporu ver:

- Başlanacak fazın adı
- Bu fazda yapılacak ana işler
- Dokunulması beklenen dosya/dizinler
- Beklenen doğrulama komutları
- Bilinen riskler veya önceki fazdan kalan durumlar

Bu rapordan sonra kullanıcıdan açık onay bekle. Kullanıcı onay vermeden o faza
başlama.

### Faz Sırasında

- Faz kapsamı dışına çıkma.
- Faz içinde gerekirse küçük düzeltmeler yap, fakat sonraki fazın işlerini başlatma.
- Kapsamın büyümesi gerekiyorsa kullanıcıya rapor verip onay iste.

### Faz Bittiğinde

Faz tamamlanınca dur ve bitiş raporu ver. Rapor şunları içermelidir:

- Değişen dosyalar
- Ne değişti
- Neden değişti
- Doküman, görev ve changelog güncellemeleri
- Çalıştırılan doğrulama komutları ve sonuçları
- Kalan risk veya eksik varsa açık not

Bitiş raporundan sonra kullanıcıdan sonraki faza geçiş onayı bekle. Kullanıcı
onay vermeden sonraki fazın planını uygulamaya geçirme.

## Mevcut Faz Durumu

- Faz 0 depo iskeleti ve araç zinciri tamamlanmıştır.
- Faz 1 Electron kabuğu ve güvenlik temeli tamamlanmıştır.
- Faz 2 paylaşılan sözleşmeler temeli tamamlanmıştır.
- Faz 3'e başlamadan önce kullanıcıya Faz 3 başlangıç raporu verilmeli ve açık
  onay alınmalıdır.

## Dokümantasyon ve Görev Takibi

- Davranış, mimari, API, yapılandırma, kullanıcı akışı, görev durumu veya doğrulama
  hattı değişirse ilgili doküman güncellenmelidir.
- Anlamlı tamamlanan işler için `docs/changelogCommitMind.md` içine tarihli kayıt
  eklenmelidir.
- Anlamlı özellik, bug fix veya mimari iş için görev dosyası oluşturulmalı veya
  güncellenmelidir.
- Tamamlanan görevler `docs/tasks/done/YYYYMMDDHHmm-slug.md` formatıyla tutulmalıdır.

## Doğrulama

Faz veya görev tamamlandı denmeden önce en küçük ilgili doğrulama çalıştırılmalıdır.

Mevcut temel komutlar:

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm format:check
corepack pnpm test
corepack pnpm build
```

Her faz sonunda ayrıca manuel dev açılış kontrolü yapılmalıdır:

```bash
corepack pnpm dev
```

Bu kontrolün sonucu faz bitiş raporunda açıkça yazılmalıdır:

- Dev komutu başlatıldı mı?
- Electron penceresi açıldı mı?
- `ForgePilot` pencere başlığı göründü mü?
- Hata çıktısı var mı?
- Dev süreci açık mı bırakıldı, yoksa kapatıldı mı?

`pnpm` PATH içinde yoksa `corepack pnpm ...` kullan.

## Kodlama Kuralları

- Minimal, hedefli ve gözden geçirilebilir değişiklik yap.
- Mevcut mimariyi ve dosya düzenini koru.
- String birleştirmeli shell komutlarıyla süreç çalıştırma tasarlama; Node tarafında
  `execFile` veya `spawn` argüman dizileri tercih edilmelidir.
- Renderer'dan main-process sorumluluklarını import etme.
- `shared/` kodu main veya renderer'a bağımlı olmamalıdır.
- Gereksiz soyutlama, geçici çözüm veya atıl iskelet ekleme.
- Kullanıcı özellikle istemedikçe commit atma.
