# ForgePilot — Geliştirme Planı (Sıfırdan Çalışan Uygulamaya)

Bu doküman, depoda şu anda yalnızca README.md bulunan ForgePilot projesinin,
README'de tarif edilen mimariye uygun şekilde adım adım nasıl inşa edileceğini
tanımlar. Aşamalar bağımlılık sırasına göre dizilmiştir: bir sonraki aşama,
kendinden öncekinin ürettiği sözleşmelere/temele dayanır.

> Teknik detaylar (bileşen diyagramı, durum makineleri, Cloud API sözleşmesi,
> UI/ekran tasarımı, MVP kapsamı) için: [DESIGN.md](DESIGN.md). Çelişki
> durumunda teknik detayda DESIGN.md, sıralamada bu doküman esas alınır.

## Önce Karara Bağlanması Gereken Mimari Kararlar

Aşağıdaki kararlar Faz 0–2'de netleştirilir ve sonraki tüm fazlarda referans alınır.

1. **Paket yönetimi / dizin yapısı**: pnpm workspaces; tek paket + TS path alias
   (`@shared/*`, `@main/*`, `@renderer/*`, `@services/*`). Depo bu ölçekte iken
   çoklu-paket yayınlama karmaşıklığına gerek yok.
2. **Build aracı**: `electron-vite` (main/preload/renderer için Electron'a özel,
   Vite+TS+React destekli, HMR'lı). README'nin yığınıyla birebir uyumlu.
3. **Renderer state yönetimi**: Zustand (`renderer/stores/`) — hafif, README'deki
   `stores/` klasörüyle örtüşüyor, gereksiz Redux seremonisi yok. Sunucu/IPC
   kaynaklı asenkron veri için React Query benzeri bir katman eklenir.
4. **IPC sözleşme stratejisi**: Şema-öncelikli. `shared/schemas/*.ts` içinde her
   IPC istek/yanıtı için Zod şeması, `shared/types/*.ts` içinde `z.infer` ile
   türetilmiş TS tipleri. Preload, `contextBridge.exposeInMainWorld` ile **sabit,
   isimlendirilmiş bir API nesnesi** sunar (`window.forgepilot.projects.open(...)`)
   — asla genel bir `invoke(channel, ...args)` geçişi değil. Her `ipcMain.handle`,
   girdi/çıktıyı Zod ile doğrular.
5. **ProviderAdapter arayüzü**: `shared/types/provider-adapter.ts` içinde, Claude
   Code veya Codex adaptörlerinden önce tanımlanır. README'deki kavramsal arayüze
   (`isInstalled`, `getVersion`, `getStatus`, `startTask`, `stopTask`, `readOutput`,
   `dispose`) ek olarak canlı çıktı akışı için `onOutput`/`onExit` olayları içerir.
6. **İnce istemci / sunucu-güdümlü iş akışı kısıtı**: ForgePilot içinde aşama
   sıralaması, prompt metni, puanlama mantığı veya orkestrasyon dallanması
   **hard-code edilemez**. `services/jobs` ve `main/process` yalnızca: (a) buluttan
   görev iste, (b) görevin talimatını adaptöre olduğu gibi ilet, (c) ham çıktıyı
   topla, (d) genel/teknik yerel kontroller yap (exit code, dosya diff'i,
   çıktı şeması uyumu), (e) sonucu buluta geri gönder. `if stage === "Architecture"`
   türü bir dallanma, sunucu-taraflı mantığın istemciye sızdığının işaretidir.
7. **Kimlik bilgisi saklama**: Electron'un `safeStorage` API'si (OS anahtarlığı —
   Keychain/DPAPI/libsecret) yalnızca ForgePilot'un kendi AI Factory Cloud
   oturum token'ı için kullanılır. Claude Code/Codex kimlik bilgilerine ForgePilot
   hiç dokunmaz; adaptörler yalnızca `getStatus()`/`isInstalled()` çağırır.
8. **SQLite sürücüsü**: `better-sqlite3`, yalnızca main process'ten erişilir
   (renderer'dan asla). Native modül olduğundan Faz 11 paketlemede
   `@electron/rebuild` adımı gerekir.
9. **AI Factory Cloud sözleşmesi**: Bu depo kapsamı dışında olan bulut sunucusu,
   versiyonlanmış bir Zod sözleşmesiyle (`shared/schemas/cloud-api.ts`) ve
   geliştirme sırasında yerel bir mock sunucuyla ele alınır.
10. **Genişletilmiş ProviderAdapter**: README'deki 7 metoda ek olarak
    `authenticate()` (yalnızca durum sorgusu — credential'a dokunmaz),
    `sendInput()` (interaktif CLI stdin'i) ve `killProcess()` (son çare
    sonlandırma) eklenir; ayrıntılı imza DESIGN.md §5'te.
11. **Heartbeat'li job sözleşmesi**: Job akışı yalnızca request/result değil —
    `POST /jobs/{id}/heartbeat` (30sn) ve `POST /jobs/{id}/fail` de sözleşmenin
    parçasıdır; sunucu, kesilen istemcileri heartbeat kesilmesinden tespit eder.
12. **Version negotiation**: Her oturum `POST /session/handshake` ile başlar
    (`desktopVersion` / `protocolVersion` / `supportedCapabilities`); sunucu
    `update-required` dönerse yeni run başlatma kilitlenir (Faz 10).
13. **Yerel DB = cache, sunucu = source of truth**: Findings/workflow/stage
    verilerinde çakışma durumunda sunucu kazanır. Yerel otorite yalnızca proje
    listesi, kullanıcı ayarları, run geçmişi ve loglardır. Job talimat gövdeleri
    hiçbir zaman diske yazılmaz (IP koruması — DESIGN.md §8).

---

## Faz 0 — Depo İskeleti ve Araç Zinciri

**Hedef**: Kurulabilen, tip kontrolünden geçen, lint'lenen, CI iskeletine sahip
boş-ama-derlenebilir bir depo.

**Bağımlılık**: Yok (ilk faz).

1. Kök `package.json`, pnpm workspaces (`pnpm-workspace.yaml`); tek paket +
   path alias yaklaşımı (bu ölçek için en basit).
2. Kök `tsconfig.json`: `@shared/*`, `@main/*`, `@renderer/*`, `@services/*`
   path alias'ları; `strict: true`, `noUncheckedIndexedAccess: true` en baştan
   (sonradan eklemek pahalı).
3. `electron-vite` + `electron-builder` devDependency olarak kurulur; üç girişli
   yapı (main/preload/renderer) iskelet halinde oluşturulur.
4. ESLint (TS + React + import-order) ve Prettier; `.editorconfig`; `lint` ve
   `format:check` script'leri.
5. Vitest kurulumu (birim testler için); Playwright-for-Electron notu (tam
   kurulumu Faz 11'de).
6. `.gitignore` (node_modules, dist, release, .vite, yerel SQLite db dosyaları, *.log).
7. GitHub Actions CI: install → typecheck → lint → unit test, Windows/macOS/Linux
   matrisi (Electron paketleme ve dosya izinleri OS'a özgü olduğundan erken şart).
8. `docs/DEVELOPMENT.md`: `pnpm install`, `pnpm dev`, `pnpm build` (yer tutucu,
   sonraki fazlarda gerçek komutlarla doldurulacak).

**Bitti kriteri**: `pnpm install && pnpm typecheck && pnpm lint` boş-iskelet
depoda başarılı; CI yeşil.

---

## Faz 1 — Electron Kabuğu ve Güvenlik Temeli

**Hedef**: Hiçbir özellik eklenmeden önce tam güvenlik duruşu kilitlenmiş,
açılabilen bir Electron penceresi.

**Bağımlılık**: Faz 0.

**Neden bu kadar erken**: `contextIsolation`, devre dışı Node entegrasyonu ve
kısıtlı preload yüzeyi yapısaldır — sonraki her IPC kanalı, her renderer
özelliği bu sınıra göre yazılır. Özellikler eklendikten sonra güvenlik eklemek,
ya tüm mevcut IPC çağrılarının denetlenmesini gerektirir ya da güvensiz
varsayılanların üstünün örtülmesine yol açar. README'nin Güvenlik Modeli
bölümü bunun pazarlık konusu olmadığını açıkça belirtiyor.

1. `src/main/app/main.ts`: tek `BrowserWindow`,
   `webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload }`.
2. `src/main/app/window.ts`: pencere yaşam döngüsü, `app.requestSingleInstanceLock()`.
3. `src/preload/index.ts`: boş `contextBridge.exposeInMainWorld('forgepilot', {})`
   iskeleti — desen (asla ham `ipcRenderer` sızdırmama) şimdi kurulur.
4. Sıkı Content-Security-Policy (renderer için): `default-src 'self'`, uzak
   script yürütme yok, `unsafe-eval` yok.
5. Tehlikeli Electron varsayılanları kapatılır: `webSecurity: true`,
   `will-navigate`/`new-window`/`setWindowOpenHandler` izin listesi dışına kapalı.
6. **IPC kanal adlandırma + doğrulama deseni** burada kurulur: `src/main/ipc/registerHandler.ts`
   içinde `defineIpcHandler(schema, handler)` yardımcı fonksiyonu — Zod ile
   girdi/çıktı doğrulaması yapan tek desen; sonraki her faz bunu kullanır.
7. `src/main/security/` modülü: CSP politikası, navigasyon korumaları, (Faz 6'da
   kullanılacak) `safeStorage` sarmalayıcısı için iskelet.
8. `src/renderer`: minimal React + Vite kabuğu, `window.forgepilot.ping()`
   round-trip'i ile preload köprüsünü kanıtlar.
9. Güvenlik regresyon testi: `nodeIntegration: false`, `contextIsolation: true`,
   `sandbox: true` doğrulaması (sonraki fazlarda kazara bozulmaya karşı).
10. `src/main/environment/` modül iskeleti: internet/sunucu/Git/CLI/PATH
    kontrollerinin (Environment Check, DESIGN.md §16.2) yaşayacağı modül —
    gerçek kontroller Faz 4 ve 6'da doldurulur, iskelet ve test düzeni şimdi kurulur.
11. `src/main/process/orphanReaper.ts` iskeleti: açılışta önceki oturumdan
    kalan sahipsiz CLI process'lerini tespit/temizleme (implementasyon Faz 5'te).

**Bitti kriteri**: `pnpm dev` pencereyi açar; renderer'ın doğrudan Node/`require`/
`process` erişimi yok (test ile doğrulanır); doğrulanmış desenle IPC round-trip çalışır.

---

## Faz 2 — Paylaşılan Sözleşmeler Temeli (tipler, şemalar, sabitler)

**Hedef**: Sonraki her fazın konuşacağı ortak dil — özellik kodu yazılmadan
önce merkezi olarak tanımlanır.

**Bağımlılık**: Faz 1 (doğrulanacak IPC handler deseni mevcut).

**Neden Faz 3–6'dan önce**: Proje yönetimi, sağlayıcı adaptörleri, süreç
çalıştırma ve bulut API istemcisi hepsi aynı kavramları (Proje, ProviderAdapter,
Job/Task, Result, Finding) paylaşır. Her faz kendi şeklini icat ederse Faz 6
(bulut istemcisi) ile Faz 4 (adaptörler) uyuşmaz hale gelir ve sonradan
uzlaştırma turu gerekir.

1. `src/shared/schemas/project.ts`: `Project` Zod şeması (id, name, rootPath,
   addedAt, lastOpenedAt); `rootPath` mutlak yol olarak doğrulanır.
2. `src/shared/schemas/provider.ts`: `ProviderId` enum (`claude-code`, `codex`,
   genişletilebilir), `ProviderStatus` (`not-installed | installed | authenticated | busy | error`),
   `ProviderVersionInfo`.
3. `src/shared/types/provider-adapter.ts`: `ProviderAdapter` TS arayüzü (davranışsal,
   Zod değil) — README'nin kavramsal arayüzü + `onOutput`/`onExit` olay
   abonelikleri. Projenin sağlayıcı-bağımsızlık vaadinin en kritik parçası;
   Faz 4'ten önce imzası netleştirilmeli.
4. `src/shared/schemas/job.ts`: `Job`, `Task`, `TaskInstructions` (buluttan gelen,
   istemci tarafından yorumlanmayan opak-benzeri yük), `TaskResult`, `Finding`.
5. `src/shared/schemas/ipc.ts`: kanal başına istek/yanıt şema haritası, alana göre
   organize (`projects.*`, `providers.*`, `jobs.*`, `logs.*`) — tüm IPC yüzeyinin
   denetlenebildiği tek kayıt.
6. `src/shared/constants/`: kanal adı sabitleri, sağlayıcı ID'leri, varsayılan
   zaman aşımı/limitler.
7. Sözleşme birim testleri: her şema için geçerli/geçersiz fixture round-trip testleri.
8. `src/shared/schemas/run.ts`: `Run` şeması + Run/Stage/Job durum makinesi
   tipleri (`src/shared/types/state-machines.ts`) — durum geçiş diyagramları
   DESIGN.md §7'de; kod bu diyagramların birebir karşılığıdır.
9. Finding lifecycle enum'u (`finding.ts` içinde): `open | acknowledged |
   in-progress | resolved | ignored | reopened`.
10. `src/shared/constants/protocolVersion.ts`: protokol sürümü + desteklenen
    capability listesi (version negotiation için, Mimari Karar #12).

**Bitti kriteri**: `shared/` hiçbir şekilde `main/`/`renderer/`'a bağımlı değil
(lint import-boundary kuralıyla zorlanır); her şemanın en az bir testi var;
`ProviderAdapter` arayüzü Faz 4'ün üzerine inşa edebileceği kadar donmuş.

---

## Faz 3 — Proje Yönetimi (yerel proje seçme/açma)

**Hedef**: Kullanıcı yerel bir klasörü "proje" olarak seçebilir, ForgePilot
bunu kalıcılaştırır ve sonraki fazların (süreç çalıştırma, sağlayıcılar) uyması
gereken dosya sistemi sınırını kurar.

**Bağımlılık**: Faz 1 (kabuk/IPC deseni), Faz 2 (`Project` şeması).

**Neden sağlayıcılardan/süreç çalıştırmadan önce**: Sağlayıcılar ve süreç
çalıştırma, sınırlandırılmış bir çalışma dizinine ihtiyaç duyar. "Açık proje
dizini sınırları" güvenlik gerekliliği, sınır-uygulama mantığının herhangi bir
süreç başlatılmadan önce var olmasını gerektirir.

1. `src/main/filesystem/pathGuard.ts`: bir yolu çözüp onaylı proje kökü içinde
   olduğunu doğrulayan yardımcı (`..` traversal reddi, `fs.realpath` ile symlink
   kaçışı kontrolü).
2. `src/services/projects/projectRepository.ts`: bilinen projeler için CRUD;
   başlangıçta `app.getPath('userData')` altında düz JSON dosyası (SQLite
   entegrasyonu Faz 8'e ertelenir, ama arayüz şimdiden depolama-bağımsız yazılır).
3. `src/main/ipc/projects.ts`: `projects:list`, `projects:add` (dizine kısıtlı
   `dialog.showOpenDialog`), `projects:remove`, `projects:open` handler'ları,
   Faz 2 şemalarına ve `pathGuard`'a karşı doğrulanmış.
4. Preload eklemeleri: `window.forgepilot.projects.{list,add,remove,open}`.
5. Renderer: `renderer/stores/projectStore.ts` (Zustand) + `renderer/pages/ProjectsPage`
   + `renderer/components/ProjectCard` — bilinen projeleri listele, "Proje Ekle"
   akışı, "Aç" ile proje çalışma alanına geçiş (şimdilik yer tutucu).
6. "Son açılan proje" kalıcılığı (yeniden başlatma kolaylığı için; şimdilik
   userData JSON, Faz 8'de SQLite'a taşınır).

**Bitti kriteri**: Kullanıcı native dialog ile klasör ekleyebilir, listede
görebilir, uygulamayı yeniden açtığında hâlâ görebilir; proje kökü dışına
işaret eden bir yol denemesi (`pathGuard` birim testiyle) reddedilir.

---

## Faz 4 — Sağlayıcı Tespiti ve Adaptörler (Claude Code, Codex)

**Hedef**: ForgePilot kurulu kodlama-ajanı CLI'larını tespit edebilir, durumunu
raporlayabilir ve tek biçimli bir adaptör yüzeyi sunabilir — henüz gerçek görev
çalıştırmadan (bu Faz 5'te).

**Bağımlılık**: Faz 2 (`ProviderAdapter` arayüzü, sağlayıcı şemaları), Faz 3
(adaptörün çalışma dizini olarak proje kökü).

1. `src/main/providers/registry.ts`: `ProviderId`'ye göre anahtarlanmış
   adaptörleri tutan `ProviderRegistry`; `list()`, `get(id)`.
2. `src/main/providers/claudeCodeAdapter.ts`: `ProviderAdapter` implementasyonu.
   - `isInstalled()`: `claude` CLI'ını PATH'te/OS'a özgü konumlarda güvenli
     şekilde ara (`child_process.execFile`, asla string birleştirmeli `exec` değil
     — shell-injection riskini önler).
   - `getVersion()`: `execFile('claude', ['--version'])`, ayrıştırılmış.
   - `getStatus()`: CLI kimlik doğrulama durumunun en iyi çaba kontrolü (hafif,
     yan etkisiz bir CLI çağrısı veya config dosyası varlığı) — kimlik bilgisinin
     kendisini asla okumaz/saklamaz, yalnızca bir durum sinyali üretir.
   - `startTask`/`stopTask`/`readOutput`/`dispose`: burada `NotImplemented` fırlatan
     iskelet; gerçek implementasyon Faz 5'te süreç çalıştırmayla birlikte gelir
     (görev başlatmak zaten süreç çalıştırmanın ta kendisi).
3. `src/main/providers/codexAdapter.ts`: Codex CLI için aynı şekil.
4. `src/main/ipc/providers.ts`: `providers:list`, `providers:detect` (registry
   genelinde `isInstalled`/`getVersion`/`getStatus` çalıştırır), `providers:refresh`.
5. Preload eklemeleri: `window.forgepilot.providers.{list,detect,refresh}`.
6. Renderer: `renderer/stores/providerStore.ts`, durum rozetli (✓ kurulu / bulunamadı
   / kimlik doğrulanmamış) "Sağlayıcı Seç" bileşeni — README akışının 3–4. adımı.
7. Adaptör kayıt genişletilebilirlik deseni (`registry.ts` içinde basit bir
   constructor dizisi) şimdi belgelenir — üçüncü bir sağlayıcı eklemek tek dosyalık
   bir değişiklik olur.
8. `authenticate()` implementasyonu (her adaptörde): CLI oturum durumunun
   yan etkisiz sorgusu — credential okunmaz/saklanmaz (Mimari Karar #10).
9. `src/main/environment/gitDetect.ts`: Git kurulum/sürüm tespiti + seçili
   projenin branch/remote bilgisi (Projects kartında gösterilir).
10. Renderer: **Environment Check / Setup sayfası** (DESIGN.md §16.2) —
    kontrol listesi (✓/✕), "Installation Instructions" paneli, "Check Again"
    butonu, sağlayıcı seçimi. Sunucu kontrol satırı Faz 6'ya kadar mock'a bağlanır.

**Bitti kriteri**: Gerçek Claude Code/Codex CLI'ı kurulu bir makinede ForgePilot
kurulu/versiyon/durumu doğru raporlar; hiçbiri kurulu değilken UI çökmeden
"kurulu değil" gösterir; adaptörler asla shell string'i (`exec`) çağırmaz —
yalnızca `execFile`/`spawn` argüman dizileriyle.

---

## Faz 5 — Süreç Çalıştırma ve Sağlayıcıları Yerelde Çalıştırma IPC'si

**Hedef**: Gerçek görev çalıştırma — CLI'ı görev talimatına karşı başlat,
canlı çıktıyı renderer'a akıt, iptali destekle.

**Bağımlılık**: Faz 3 (proje sınırı), Faz 4 (adaptör iskeletleri), Faz 2
(`ProviderOutputChunk`/`Task` şemaları).

**Neden ayrı ve bulut istemcisinden önce bir faz**: Süreç çalıştırma en yüksek
riskli yüzeydir (keyfi yerel komut çalıştırma) — canlı ağ-güdümlü bir görev
kaynağına bağlanmadan önce izole tasarım/inceleme hak eder. Önce **yerelde
elle hazırlanmış fixture görevlerine** karşı inşa edip test etmek, Faz 6'nın
süreç-yönetimi hatalarını API-entegrasyon hatalarıyla karıştırmadan
eklenebilmesini sağlar.

1. `src/main/process/processManager.ts`: `child_process.spawn` sarmalayıcısı;
   `cwd` = proje kökü (`pathGuard` ile), `shell: true` yok, açık `env` izin
   listesi (üst süreç env'ini körlemesine miras almak yerine ilgisiz sırları
   sızdırmamak için kürase edilmiş), yakalanan stdout/stderr akışları.
2. `claudeCodeAdapter`/`codexAdapter` üzerinde gerçek `startTask`/`stopTask`/
   `readOutput`/`dispose` — `processManager` kullanarak, CLI'ın kendi çağırma
   kurallarını (bayraklar, stdin prompt teslimi, JSON/akış çıktı ayrıştırma)
   Faz 2'nin normalize `ProviderOutputChunk`/`ProviderExitInfo` olaylarına çevirir.
3. `src/main/ipc/tasks.ts`: `tasks:start`, `tasks:stop`, artı canlı çıktı için
   push-tabanlı kanal (`webContents.send` — `invoke` istek/yanıttır, canlı çıktı
   main→renderer gönderim tarafını gerektirir, yine şema doğrulamalı).
4. Preload: `window.forgepilot.tasks.{start,stop}` ve `onOutput`/`onExit`
   abonelik API'si (renderer'ın `ipcRenderer`'a asla doğrudan dokunmaması için
   içeride sarmalanmış).
5. Renderer: `renderer/stores/taskStore.ts`, canlı çıktı/konsol görünümü,
   başlat/durdur kontrolleri.
6. Süreç yaşam döngüsü sağlamlaştırma: uygulama kapanışında/çökmesinde alt
   süreçleri öldür (`app.on('before-quit')`), kaçak görev için zaman aşımı
   koruması, çok konuşkan çıktı akışları için backpressure/tamponlama stratejisi
   (Faz 7 log dosyasına bağlanır).
7. Manuel test düzeneği: gerçek bir CLI kurulu olmasını gerektirmeyen "echo görevi"
   fixture'ı — süreç-yönetimi mantığı Claude Code/Codex kullanılabilirliğinden
   bağımsız test edilebilir.
8. `sendInput()` ve `killProcess()` implementasyonu: interaktif CLI'a stdin
   iletimi; kademeli sonlandırma (önce SIGTERM/nazik kapatma, zaman aşımında kill).
9. Çıktı hacmi yönetimi: UI tarafında ring-buffer (son ~2000 satır), IPC'ye
   toplu (batched) gönderim; tam akış rotasyonlu log dosyasına (DESIGN.md Risk #4).
10. `orphanReaper` implementasyonu: PID kayıt dosyası + açılışta sahipsiz
    process tespiti/temizliği; `before-quit` temizliğiyle birlikte çalışır.
11. Stop akışı: UI onay diyaloğu → nazik kapatma → zaman aşımında zorla;
    her iki yol da normalize `ProviderExitInfo` üretir (Pause/Resume MVP-sonrası,
    DESIGN.md §7 "job sınırında duraklat" kararına göre).

**Bitti kriteri**: Gerçek kurulu bir sağlayıcı CLI'ına karşı görev başlatılabilir,
canlı çıktı renderer'da görünür, durdur alt süreci temiz iptal eder, uygulama
kapanışı yetim süreç bırakmaz; çalıştırma asla seçili projenin dizini dışında
gerçekleşmez.

---

## Faz 6 — AI Factory Cloud API İstemcisi (görev iste/al/çalıştır/döndür)

**Hedef**: Tescilli buluta ağ sınırı — gerçek sunucu bu depo kapsamı dışında
olduğundan, varsayılan, versiyonlanmış, mock'lanabilir bir sözleşmeye karşı
implemente edilir.

**Bağımlılık**: Faz 2 (Job/Task/Finding şemaları), Faz 5 (bulut-kaynaklı
görevleri devredecek süreç çalıştırma).

**Neden süreç çalıştırmadan sonra, önce değil**: Bulut istemcisinin işi Faz 5'te
kurulan süreç-çalıştırma boru hattını fixture'lar yerine gerçek görevlerle
beslemektir. Faz 5'ten sonra inşa etmek, README'nin "görev al → çalıştır →
döndür" döngüsünün çalışan bir yerel yarısına takılmasını sağlar.

1. `src/shared/schemas/cloud-api.ts`: varsayılan sözleşme Zod şemaları —
   `RequestJob` (proje/sağlayıcı metadatası → `Job`), `GetTask` (`Job` → `Task`),
   `SubmitResult` (`TaskResult` → ack), `SyncFindings` (`Finding[]` → ack).
   Sözleşme versiyonlanır (`cloudApiVersion` sabiti) — gerçek sunucu sapması
   tespit edilebilir olsun diye.
2. `src/services/api/httpClient.ts`: yalnızca HTTPS zorlayan ince fetch
   sarmalayıcısı (`http://` reddedilir, açık `localhost` dev istisnası hariç),
   `safeStorage`'dan çözülmüş token ile auth header ekler, timeout/retry/hata
   eşlemesini merkezileştirir.
3. `src/main/security/credentialStore.ts`: Electron `safeStorage.encryptString`/
   `decryptString` sarmalayıcısı; şifreli blob `userData`'da (Faz 8'de SQLite'a
   taşınır) saklanır; `getToken()/setToken()/clearToken()` sunar.
4. `src/services/jobs/jobService.ts`: dört adımlı akışı implemente eder —
   `requestJob(project, providerId)` → `getTask(jobId)` → (Faz 5'in
   `processManager`/adaptörüne devret) → `submitResult(jobId, result)` →
   `syncFindings(jobId, findings)`. Bilinçli olarak "aptal" bir modül: aşama/iş
   akışı dallanması yok, yalnızca ileri iletme.
5. **Mock bulut sunucusu** (geliştirme için): Faz-6-adım-1 sözleşmesini
   implemente eden küçük bir yerel Express/Fastify sunucusu; hazır Job/Task/ack
   yanıtları döndürür, `pnpm dev:mock-cloud` ile çalışır — gerçek AI Factory
   Cloud olmadan Faz 6–9 UI/entegrasyon çalışmasını mümkün kılar.
6. `src/main/ipc/jobs.ts` + preload + `renderer/stores/jobStore.ts`: görev
   yaşam döngüsünü UI'a açar (görev iste → görev alındı göster → çalıştırma
   göster → sonuç gönderildi göster) — README'nin 10 adımlık akışını ilk kez
   uçtan uca bağlar.
7. Auth/giriş akışı: AI Factory Cloud'un ForgePilot'u nasıl doğruladığı (şimdilik
   API key veya cihaz-auth akışı varsayımı, açık soru olarak belgelenir) —
   token girmek/saklamak için `renderer/pages/Login` veya ayarlar paneli
   (`credentialStore` üzerinden).
8. Sözleşme testleri: aynı Zod şemaları hem mock sunucunun yanıtlarına hem de
   (ileride) gerçek sunucuya karşı çalıştırılır — sözleşme sapması sahada değil
   CI'da yakalanır.
9. Genişletilmiş endpoint seti (DESIGN.md §6): `POST /session/handshake`
   (version negotiation), `GET /workflows/current` (server-driven stage
   listesi), `POST /jobs/{id}/heartbeat` (30sn döngü, powerMonitor
   uyku/uyanma tetiklemesiyle), `POST /jobs/{id}/fail` (sınıflandırılmış hata
   raporu). Mock sunucu bunların tamamını implemente eder.
10. Offline / degraded mod: sunucuya ulaşılamadığında durum çubuğu + banner
    ("mevcut veriler görüntülenebilir, yeni run başlatılamaz"), yeniden deneme
    butonu; kritik proprietary içerik offline cache edilmez.

**Bitti kriteri**: Mock bulut sunucusu çalışırken README akışının tamamı
(proje seç → sağlayıcı seç → görev iste → çalıştır → sonuç gönder → bulguları
senkronize et) uygulamada uçtan uca tamamlanır; token hiçbir zaman logda veya
diskte düz metin görünmez; `httpClient`'ın base URL'ini mock'tan gerçek
sunucuya çevirmek yalnızca config değişikliği gerektirir, kod değişikliği değil.

---

## Faz 7 — Yerel Doğrulama + Sonuçlar/Bulgular UI'ı

**Hedef**: Sağlayıcı çıktısının genel, istemci-taraflı teknik doğrulaması ve
sonuçları/bulguları incelemek için yapılandırılmış bir UI — açıkça alan
puanlaması değil (o bulut-taraflı).

**Bağımlılık**: Faz 5 (görev sonuçları var), Faz 6 (`Finding` şeması,
doğrulama çıktısının ekleneceği gönderim akışı).

1. `src/services/runs/localValidators/`: küçük bir genel, sağlayıcı-bağımsız
   kontrol seti — örn. exit-code kontrolü, "beklenen dosyalar değişti" kontrolü
   (proje köküne karşı git status diff'i), çıktı-beyan-edilen-şemayla-eşleşiyor-mu
   kontrolü. Her doğrulayıcı saf bir fonksiyon: `(TaskResult) => Finding[]`.
2. `src/services/runs/validationPipeline.ts`: görev tamamlandıktan sonra,
   `submitResult`/`syncFindings`'ten önce ilgili doğrulayıcıları çalıştırır —
   ham sonuca yerel olarak türetilmiş bulguları ekler.
3. `renderer/features/results/`: sonuçlar/bulgular görünümleri — diff görüntüleyici,
   önem derecesi/durumlu bulgular listesi, ham çıktı/log sekmesi.
4. `renderer/stores/resultsStore.ts`: görev tamamlanma olaylarını (Faz 5) alınan/
   türetilen bulgularla görüntüleme için bağlar.
5. Sınır açıkça belgelenir (kod yorumu + mimari doküman): yerel doğrulayıcılar
   yalnızca *mekanikleri* kontrol eder (çalıştı mı, beklenen artefakt şeklini
   üretti mi); kalite/doğruluk puanlamasına benzer hiçbir şey implemente etmez
   — bu bulutun sahip olduğu bir alan.
6. **Dashboard** (DESIGN.md §16.4): sunucudan gelen stage listesinin dinamik
   render'ı (✓/●/○ durumları), progress çubuğu, aktif agent/operasyon metni,
   findings özet sayaçları, Live Activity akışı — istemcide sabit stage adı
   veya stage-bazlı dallanma yazılmaz (Mimari Karar #6).
7. Findings ekranı genişletmesi: severity/stage/status/agent/dosya filtreleri,
   detay paneli (dosya:satır, açıklama, öneri), lifecycle durum değiştirme
   (`open → acknowledged → in-progress → resolved/ignored`, `reopen`) +
   `POST /findings/sync` ile sunucu senkronu ve "not synced" rozeti.
   (MVP'de salt görüntüleme; lifecycle+senkron MVP-sonrası — DESIGN.md §12.)
8. **Run yöneticisi** (`src/services/runs/runManager.ts`): Run durum makinesi
   (DESIGN.md §7), her durum geçişinde SQLite `runs.checkpoint`'e senkron yazım,
   run geçmişi ekranı (tablo + run detayı: stage zaman çizelgesi, job listesi).
9. **Crash recovery**: açılışta `running/preparing` durumunda kalmış run
   tespiti → `interrupted` işaretle → Resume/Discard diyaloğu (DESIGN.md §10);
   Resume'da otorite sunucudur (`GET /jobs/{id}` ile gerçek durum sorgulanır).
   (Checkpoint altyapısı bu fazda; diyalog UI'ı MVP-sonrası tamamlanabilir.)

**Bitti kriteri**: Bir görev çalıştırmasından sonra (Faz 5/6 akışı), UI en az
bir genel yerel doğrulama bulgusuyla (örn. exit code) yapılandırılmış bir
sonuçlar görünümü gösterir ve bu bulgu Faz 6'nın `syncFindings` yüküne dahil
edilir; Dashboard, mock workflow'un stage listesini sunucu verisinden render
eder; tamamlanan her çalıştırma Runs ekranında bir Run kaydı olarak görünür.

---

## Faz 8 — Loglama ve Log Redaksiyonu

**Hedef**: README'nin "şeffaflık" ilkesini destekleyen kalıcı, incelenebilir
loglar; sırların garanti redaksiyonuyla.

**Bağımlılık**: Faz 3–6 (loglanacak gerçek olay kaynaklarının var olması gerekir).

**Neden bu kadar geç**: Loglama, önceden tahmin edilmeye çalışılmaktansa
gerçek olay kaynaklarıyla (hangi alanlar önemli, ne redakte edilmeli) anlamlı
şekilde tasarlanmalı; ama Faz 9 (SQLite) ve Faz 11'den (paketleme) önce
oturmuş olmalı.

1. `src/main/logging/logger.ts`: yapılandırılmış logger (örn. pino),
   `userData/logs/*.log`'a rotasyonlu yazar, dev'de konsola da yazar.
2. `src/main/logging/redact.ts`: her log satırına uygulanan redaksiyon
   dönüşümü — bilinen-şekilli sırları (API anahtarları, bearer token'lar,
   `credentialStore`'dan kaynaklananlar) maskeler ve alan adı kara listesi
   (`token`, `password`, `apiKey`, `authorization`) değer şeklinden bağımsız
   redakte edilir. Düşmanca fixture'larla agresif test edilir (string ortasına
   gömülü sırlar, iç içe nesneler, token'ı yansıtabilecek CLI çıktısı).
3. Faz 3–6'daki mevcut modüller (proje eylemleri, sağlayıcı tespiti, süreç
   başlatma/çıkış, HTTP istek/yanıt) paylaşılan logger üzerinden
   enstrümante edilir — redaksiyon politikasının tek bir denetim turunda
   merkezi kalması için burada bilinçli olarak toplu yapılır.
4. `src/main/ipc/logs.ts` + preload + `renderer/features/logs/LogViewer`:
   kullanıcının uygulama içinden logları görüntülemesi (ve dışa aktarması) —
   README'nin "Şeffaflık" bölümünün doğrudan gerçekleşmesi.
5. Sağlayıcı süreç stdout/stderr'i (Faz 5) de log deposuna yakalanır
   (redaksiyon uygulanmış), yalnızca yapılandırılmış uygulama olayları değil.

**Bitti kriteri**: Loglanan bir kod yolundan geçen kasıtlı sahte bir token,
log dosyasında asla düz metin olarak görünmez (test ile doğrulanır); kullanıcı
uygulama içi log görüntüleyiciyi açıp son eylemleri görebilir; log dosyaları
git'e dahil değildir.

---

## Faz 9 — Yerel Önbellek / SQLite / Durum Kalıcılığı

**Hedef**: Faz 3 ve 6'daki geçici JSON dosya kalıcılığını gerçek SQLite
depolamayla değiştir; sağlayıcı durumu/görev geçmişi için önbellekleme ekle.

**Bağımlılık**: Faz 3 (taşınacak proje deposu arayüzü), Faz 6 (kalıcılaştırılacak
kimlik bilgisi/görev geçmişi), Faz 8 (migrasyonların/sorguların loglanması için).

**Neden bu kadar geç**: Faz 3 bilinçli olarak depolama-bağımsız bir repository
arayüzü kullandığından, SQLite temel bir engel yerine bir backend değişimi
olarak eklenebilir — bu, çalışan bir uygulama olmadan SQLite/native modül
kurulum maliyetini (Faz 11 paketleme karmaşıklığı) baştan ödemeyi önler.

1. `src/services/db/schema.ts` + migrasyon çalıştırıcı: `projects`, `runs`
   (checkpoint sütunuyla), `jobs`, `task_results`, `findings_cache`,
   `settings`, `logs_index` tabloları (şema detayı DESIGN.md §8; job talimat
   gövdeleri tabloya yazılmaz — yalnızca meta veri).
2. `src/services/db/connection.ts`: SQLite dosyasını `app.getPath('userData')`'dan
   açar, yalnızca main-process erişimi (renderer'dan DB erişimi yok — tüm
   okuma/yazmalar IPC-doğrulamalı servis çağrılarından geçer).
3. `projectRepository` (Faz 3) ve görev/kimlik bilgisi geçmişini (Faz 6)
   SQLite-destekli implementasyona taşı; çağıran kodun (IPC handler'lar,
   store'lar) değişmemesi için repository arayüzleri aynı kalır.
4. Sağlayıcı tespit sonuçları (Faz 4) için önbellekleme katmanı — `providers:detect`
   her açılışta yeniden shell'lemesin diye TTL'li önbellek, açık "yenile" atlaması.
5. Veri saklama/temizlik politikası (örn. N günden eski veya boyut sınırını
   aşan görev/çıktı geçmişini budama) — "seçili proje dışındaki dosya/bilgi
   toplamaktan kaçın" gizlilik ilkesiyle de örtüşür.
6. Native modül derleme gereksinimini (`better-sqlite3` Electron ABI-eşleşmeli
   rebuild ister) `docs/DEVELOPMENT.md`'de şimdiden belgele.

**Bitti kriteri**: Uygulama verisi yeniden başlatmalarda SQLite üzerinden
hayatta kalır; migrasyon çalıştırıcı idempotent'tir; sağlayıcı tespiti ikinci
yüklemede belirgin şekilde önbellekli (neredeyse anlık) manuel yenileme
seçeneğiyle; hiçbir renderer kodu DB modülünü doğrudan import etmez.

---

## Faz 10 — Güncelleme Mekanizması

**Hedef**: Uygulama güncellemeleri kontrol edip uygulayabilir, "gizli depo
indirmeme" ilkesine saygı göstererek (bu uygulama güncellemeleriyle ilgili,
iş akışı zekası indirmeyle değil, ama aynı "açık, minimal, denetlenebilir" ruh
geçerli).

**Bağımlılık**: Faz 9 (güncellemeyi atlatması gereken kalıcı durum), Faz 8
(güncelleme olaylarını kaydetmek için loglama).

1. `electron-builder` çıktısıyla uyumlu güncelleme mekanizması: `electron-updater`
   (GitHub Releases veya genel statik dosya sunucusuyla çalışır) — README'nin
   ima ettiği açık kaynak dağıtım modeliyle uyumlu.
2. `src/main/updates/updateManager.ts`: zamanlanmış/manuel tetiklemeli güncelleme
   kontrolü, indirir, kurmadan önce kullanıcıya sorar (asla görünür bir bildirim
   olmadan sessizce kurmaz — şeffaflık ilkesiyle tutarlı).
3. `src/main/ipc/updates.ts` + preload + `renderer/features/updates/UpdateBanner`
   ("güncelleme mevcut", "indiriliyor", "uygulamak için yeniden başlat").
4. Güncelleme kontrolü/indirme/uygulama olaylarını Faz 8'in logger'ı üzerinden kaydet.
5. Güncelleme feed'inin barındırılacağı yer (örn. GitHub Releases) — açık kaynak
   istemci olduğundan makul bir varsayım olarak, gerçek altyapı bekleyen bir
   varsayım olarak belgelenir.
6. Version-negotiation kilidi: handshake `update-required` döndüğünde tam sayfa
   kilit ekranı — yeni run başlatılamaz, mevcut veriler görüntülenebilir,
   [Update Now] güncelleme akışını tetikler (DESIGN.md §11). "Sunucu
   değişikliği ≠ EXE update" ayrımı burada test edilir: mock sunucuda workflow
   değişikliği güncelleme istemez, protokol sürüm atlaması ister.

**Bitti kriteri**: Uygulama (başlangıçta mock/yerel) bir güncelleme feed'ini
kontrol eder, UI'da güncelleme mevcudiyetini gösterir; akış gerçek release
altyapısı olmadan bile test build'inde çalıştırılır.

---

## Faz 11 — Test Stratejisi (biçimlendirilmiş, çapraz-kesen ama burada toparlanmış)

**Hedef**: Faz 0'da örtük olarak ekilenleri açıkça ortaya koy, ve yalnızca
gerçek pencereler/süreçler var olduktan sonra gelebilecek katmanı (uçtan uca
testler) ekle.

**Bağımlılık**: Fiilen tüm önceki fazlar (artık gerçek bir uygulama var, test edilecek).

Not: birim testleri bu faza ertelenmez — Faz 0 Vitest'i kurar ve Faz 2'den
itibaren her faz tanıttığı modüller için birim testleri eklemesi beklenir.
Bu faz piramidi biçimlendirir ve çalışan bir uygulama gerektiren katmanları ekler:

1. Birim testleri (Vitest): şemalar (Faz 2), pathGuard (Faz 3), mock'lanmış
   `child_process` ile adaptörler (Faz 4/5), redaksiyon (Faz 8), doğrulayıcılar
   (Faz 7) — herhangi bir fazın atladığı kapsamı burada retroaktif denetle.
2. Entegrasyon testleri: Electron test yardımcıları veya mock `ipcMain`/`ipcRenderer`
   çifti ile IPC handler round-trip'leri, Faz 6'nın mock bulut sunucusuna karşı
   job-service akışı.
3. E2E testleri: Playwright'ın Electron desteği (veya `electron-playwright-helpers`)
   ile paketlenmiş/dev uygulamayı README akışının tamamından geçirme (proje seç
   → sağlayıcı seç → fixture/mock sağlayıcıya karşı görev çalıştır → sonuçları görüntüle).
4. Güvenlik regresyon testleri: her CI çalışmasında `contextIsolation`/
   `nodeIntegration`/`sandbox` bayraklarını (Faz 1) ve CSP header'larını doğrula
   — yalnızca Faz 1'de bir kez değil.
5. Çapraz-platform CI matrisi (Windows/macOS/Linux) en azından birim+entegrasyon
   katmanları için; e2e başlangıçta CI maliyeti/süresi için daha az OS'la
   kısıtlanabilir.
6. "Fixture sağlayıcı adaptörü" (yalnızca testlerde kullanılan sahte bir
   `ProviderAdapter` implementasyonu) ekle — sağlayıcı-bağımlı akışlar (Faz 4/5)
   gerçek Claude Code/Codex kurulumu olmadan CI'da test edilebilsin.

**Bitti kriteri**: CI her PR'da birim + entegrasyon + en azından duman-seviyeli
e2e paketini çalıştırır; `nodeIntegration: true`'ya kasıtlı bir regresyon CI'ı başarısız eder.

---

## Faz 12 — Paketleme ve Dağıtım

**Hedef**: Native modüllerin doğru şekilde yeniden derlendiği, kod imzalamanın
ele alındığı kurulabilir çıktılar üret (Windows/macOS/Linux).

**Bağımlılık**: Faz 9 (native modül `better-sqlite3` mevcut), Faz 10
(paketlenmiş çıktıya bağlanacak güncelleme mekanizması), Faz 11 (dağıtmadan
önce test edilmiş bir uygulama istenir).

1. `electron-builder.yml` içinde `electron-builder` hedefleri yapılandır
   (Windows için nsis/msi, macOS için dmg/zip, Linux için AppImage/deb).
2. `better-sqlite3` için native modül yeniden derlemesini bağla
   (`electron-builder`'ın yerleşik rebuild'i veya açık `@electron/rebuild`
   adımı) — CI'da üç OS'ta da doğrula.
3. Kod imzalama: gereksinimleri (Apple notarization, Windows Authenticode)
   dış ön koşul olarak belgele (sertifikalar/sırlar repo'da değil); imzalama
   adımlarını CI sırlarının arkasına bağla, yerelde no-op.
4. `electron-updater`'ın publish config'ini (Faz 10) seçilen artefakt
   host'una (örn. GitHub Releases) bağla.
5. Release CI iş akışı ekle: tag → build matrisi → imzala → taslak release yayınla.
6. Her OS'ta temiz-makine kurulum/kaldırma döngüsünü doğrula (Faz 9'un saklama
   politikası göz önüne alındığında sınırsız userData büyümesi olmadan).

**Bitti kriteri**: Etiketlenmiş bir commit, CI aracılığıyla üç OS için de
kurulabilir, imzalı (veya sertifika beklerken belgelenmiş-imzasız) artefaktlar
üretir; temiz bir VM uygulamayı uçtan uca kurup çalıştırabilir.

---

## Faz 13 — Güvenlik Sağlamlaştırma Turu, Dokümantasyon ve Katkı Rehberi

**Hedef**: Döngüyü kapat — README'nin Güvenlik/Gizlilik/Şeffaflık bölümlerine
karşı inşa edilen her şeyi özel bir turla denetle; artık gerçek bir mimari
olduğuna göre OSS-proje iskeletini (dokümanlar, katkı rehberi) tamamla.

**Bağımlılık**: tüm önceki fazlar (bilinçli olarak en sonda — anlamlı bir
güvenlik denetimi özellik-tamamlanmış bir uygulama gerektirir, ve "nasıl çalışır"ı
anlatan dokümanlar gerçek implementasyonu anlatmalı, hedeflenen README'yi değil).

1. Tam IPC yüzeyi denetimi: her `contextBridge`-açık metodu (Faz 1–10
   eklemeleri) numaralandır, her ikisinin de (girdi/çıktı) şema doğrulaması
   olduğunu, hiçbir kanalın doğrulanmamış serbest-form veri kabul etmediğini doğrula.
2. Dosya sistemi sınırı denetimi: `pathGuard`'ı (Faz 3) traversal/symlink/UNC-yol/
   OS başına büyük-küçük harf duyarlılığı uç durumlarıyla fuzz'la.
3. Süreç çalıştırma denetimi: hiçbir yerde `shell: true`/string-birleştirmeli
   komut olmadığını (Faz 4/5) doğrula, env-var izin listesinin özellikler
   eklendikçe hâlâ geçerli olduğunu kontrol et.
4. Ağ denetimi: HTTPS-only zorlamasının (Faz 6) hâlâ geçerli olduğunu, kazara
   `http://` fallback'i olmadığını, CSP'nin hâlâ beklenmeyen kaynakları
   engellediğini doğrula.
5. Kimlik bilgisi/loglama denetimi: redaksiyon düşmanca testlerini (Faz 8),
   artık daha büyük olan tüm loglanan olay türleri setine karşı yeniden çalıştır.
6. `docs/ARCHITECTURE.md`: fiilen inşa edileni yansıtan gerçek mimari doküman
   (modül sınırları, IPC sözleşme konumu, sağlayıcı adaptör modeli) — README'nin
   hedeflenen mimari bölümünün yerini alır/tamamlar.
7. `CONTRIBUTING.md`: kurulum talimatları (Faz 0'ın dev dokümanlarından
   olgunlaştırılmış), kodlama standartları (Faz 0 lint/format), test
   gereksinimleri (Faz 11), neyin kapsam-içi neyin kapsam-dışı olduğunun açık
   sınırı (README'nin Açık Kaynak vs Sunucu-Taraflı bölümünü yansıtarak) —
   katkıda bulunanların yanlışlıkla sunucu-taraflı olması gereken orkestrasyon/
   iş akışı mantığı eklemeye çalışmaması için.
8. `SECURITY.md`: güvenlik açığı bildirim süreci — bu güvenlik-hassas, yerel
   çalıştırmalı bir araç olduğundan.
9. README'nin "Şeffaflık" kontrol listesine karşı son tur, somut bitti kriteri
   olarak (erişilen dosyalar, çalıştırılan komutlar, başlatılan süreçler,
   yapılan ağ istekleri, buluta gönderilen veri, kimlik bilgisi yönetimi) — her
   biri Faz 1–10'da inşa edilen belirli bir modüle işaret ederek yanıtlanabilir olmalı.

**Bitti kriteri**: README'nin şeffaflık kontrol listesindeki her madde
incelenebilir bir kod yoluna eşleşir; dokümanlar gönderilen mimariyi doğru
anlatır; güvenlik-hassas modüllerde (`main/security`, `main/process`,
`main/filesystem`, `services/api`) açık TODO/FIXME kalmaz.

---

## Sıralama Mantığı Özeti

- **Faz 0→1**: araç zinciri olmadan hiçbir şey inşa edilemez; güvenlik sınırı
  kurulmadan özellik eklenemez (IPC kanalları var olduktan sonra `contextIsolation`
  eklemek her kanala tekrar dokunmayı gerektirir).
- **Faz 1→2**: IPC doğrulama *deseni* (Faz 1), doğrulayacağı *sözleşmelerden*
  (Faz 2) önce var olmalı, ama sözleşmeler herhangi bir özellik onları
  kullanmadan önce var olmalı.
- **Faz 2→3/4**: proje yönetimi ve sağlayıcı adaptörleri ilk gerçek özellikler
  ve ikisi de Faz 2'nin şemalarını/arayüzlerini doğrudan kullanır — 3 ile 4
  arasındaki sıra esnek (birbirine bağımlı değiller), ama ikisi de önce Faz 2'yi
  ister, ve sağlayıcı adaptörleri çalışma dizini referansı olarak bir proje
  köküne (Faz 3) ihtiyaç duyar.
- **Faz 4→5**: nasıl tespit edileceğini/adresleneceğini tanımlamadan
  çalıştırılamaz; tespit (4) ucuz ve düşük riskli, çalıştırma (5) pahalı ve
  yüksek riskli — önce ucuz yolu doğrula.
- **Faz 5→6**: bulut istemcisinin tüm amacı Faz 5'in çalıştırma boru hattını
  beslemektir; 6'yı 5'ten önce inşa etmek 5'in sağladığı şeyin tam olarak
  aynısını mock'lamak anlamına gelirdi.
- **Faz 6→7**: yerel doğrulama görev sonuçları üzerinde çalışır, bunlar da
  yalnızca hem çalıştırma (5) hem bulut round-trip'i (6, bulguların gönderileceği
  yer için) var olduğunda ortaya çıkar.
- **Faz 3-6→8**: loglama, gerçek loglanacak olaylar ve gerçek redakte edilecek
  sırlar olduktan sonra bilinçli olarak sonradan eklenir — hayali olaylara
  karşı redaksiyon tasarlamak tahmin yürütmektir.
- **Faz 8→9**: SQLite migrasyonu, migrasyonları gözlemlemek için loglamanın
  zaten yerinde olmasından faydalanır; Faz 3'ün arayüz disipliniyle mümkün
  kılınan bir backend değişimidir, bir engel değil.
- **Faz 9→10→12**: güncellemeler ve paketleme, fiilen kalıcılaştırılan/
  gönderilen şeye bağlıdır — uygulamanın veri modeli (9) stabil olduktan sonra
  ve nihai dağıtımdan (12) önce sıralanır.
- **Faz 11 (test) iç içe ama toparlanmış**: birim testleri boyunca olur; e2e
  özellikle çalışan bir uygulama gerektirir, bu yüzden sonlara doğru biçimlendirilir.
- **Faz 13 en son**: güvenlik/şeffaflık denetimi yalnızca tam bir yüzey alanına
  karşı anlamlıdır, ve dokümanlar planlananı değil inşa edileni anlatmalı.
- **Run yöneticisi + crash recovery Faz 7'de**: Run kaydı ancak gerçek bir
  uçtan uca akış (Faz 5+6) var olduktan sonra anlamlıdır; checkpoint altyapısı
  SQLite'tan (Faz 9) önce JSON ile başlar, Faz 9'da tabloya taşınır.
- **Environment Check iki fazda dolar**: iskelet Faz 1'de (modül sınırı erken
  çizilir), CLI/Git kontrolleri Faz 4'te, sunucu/lisans kontrolleri Faz 6'da —
  her kontrol, bağlı olduğu altyapıyla birlikte gelir.
- **Heartbeat Faz 6'da, Faz 5'te değil**: heartbeat sunucu sözleşmesinin
  parçasıdır; süreç çalıştırma yerel fixture'larla heartbeat'siz test edilir.

---

## Kritik Dosyalar (ilk implementasyon dalgası)

- `src/shared/types/provider-adapter.ts`
- `src/shared/schemas/ipc.ts`
- `src/main/app/main.ts`
- `src/preload/index.ts`
- `src/main/filesystem/pathGuard.ts`
