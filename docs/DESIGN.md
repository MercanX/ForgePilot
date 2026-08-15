# ForgePilot — Kapsamlı Teknik Tasarım Dokümanı

> Çalışma başlığı: "AI Factory Desktop". Ürün/depo adı: **ForgePilot**.
> Bu doküman, [README.md](../README.md)'deki ürün vizyonunun ve
> [BUILD_PLAN.md](BUILD_PLAN.md)'deki faz planının üzerine oturan resmi teknik
> tasarımdır. Üçü çelişirse öncelik sırası: DESIGN.md (teknik detay) →
> BUILD_PLAN.md (sıralama) → README.md (vizyon).

---

## 1. Architecture Overview (Mimari Genel Bakış)

ForgePilot, kullanıcının bilgisayarındaki projeler ile Claude Code / Codex gibi
kurulu coding agent'lar arasında çalışan, **sunucu-güdümlü (server-driven)** bir
orkestrasyon masaüstü istemcisidir.

```text
┌────────────────────────────────────────────────┐
│              ForgePilot (Desktop)              │
│                                                │
│  Desktop UI ── Project Manager ── Run Manager  │
│       │              │                │        │
│  Provider Manager ── Process Manager           │
│   ├── Claude Code    (child_process)           │
│   └── Codex                                    │
│       │                                        │
│  Local Validators ── Logs/Events ── SQLite     │
│       │                                        │
│  Secure API Client (HTTPS, token: safeStorage) │
└──────────────────────┬─────────────────────────┘
                       │ HTTPS (yalnızca job-bazlı)
                       ▼
┌────────────────────────────────────────────────┐
│           AI Factory Cloud (kapsam dışı)       │
│  Rules · Agents · Skills · Workflows · Stages  │
│  Policies · Prompt Generation · Licensing      │
└────────────────────────────────────────────────┘
```

Temel prensipler (hiçbir tasarım kararı bunları bozamaz):

1. **İnce istemci**: Proprietary intelligence (rules, agents, skills, workflows,
   master prompt'lar, scoring, decision tree'ler) EXE içine gömülmez, kalıcı
   olarak diske yazılmaz, toplu indirilmez. Yalnızca aktif job için gereken
   talimat çalışma zamanında alınır.
2. **Sunucu-güdümlü UI**: Stage listesi, workflow tanımı, aşama sıralaması
   sunucudan gelir; istemci bunları dinamik render eder. Sunucudaki rule/workflow
   değişikliği EXE rebuild gerektirmez.
3. **Sağlayıcı bağımsızlığı**: Çekirdek hiçbir zaman doğrudan Claude/Codex'e
   bağımlı olmaz; her şey `ProviderAdapter` arayüzü üzerinden geçer.
4. **Güvenlik baştan**: Electron sertleştirme, IPC doğrulama, dosya sistemi
   sınırı ve kimlik bilgisi koruması sonradan eklenen değil, temel katmandır.
5. **Kullanıcı terminal görmez**: Tüm akış (kurulum kontrolü → proje seçimi →
   sağlayıcı seçimi → çalıştırma → sonuç) masaüstü panelinden yürür.

---

## 2. Component Diagram (Bileşen Diyagramı)

```text
┌─────────────────────────── ELECTRON MAIN PROCESS ───────────────────────────┐
│                                                                             │
│  app/            environment/      ipc/               security/             │
│  ├ main.ts       ├ envCheck.ts     ├ registerHandler  ├ csp.ts              │
│  ├ window.ts     ├ gitDetect.ts    ├ projects.ts      ├ navGuard.ts         │
│  └ lifecycle     └ netCheck.ts     ├ providers.ts     ├ credentialStore.ts  │
│                                    ├ tasks.ts         └ (safeStorage)       │
│  providers/      process/          ├ jobs.ts                                │
│  ├ registry.ts   ├ processManager  ├ runs.ts          filesystem/           │
│  ├ claudeCode    └ orphanReaper    ├ findings.ts      └ pathGuard.ts        │
│  └ codex                           ├ logs.ts                                │
│                  logging/          ├ updates.ts       updates/              │
│                  ├ logger.ts       └ settings.ts      └ updateManager.ts    │
│                  └ redact.ts                                                │
│                                                                             │
│  ── services/ (main içinde çalışır, Electron API'sinden bağımsız çekirdek) ─│
│  api/httpClient  jobs/jobService   runs/runManager    projects/repository   │
│  api/cloudApi    jobs/heartbeat    runs/validators    db/connection+schema  │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ contextBridge (yalnızca tipli metodlar)
                        ┌──────────┴──────────┐
                        │      PRELOAD        │  window.forgepilot.{...}
                        └──────────┬──────────┘
                                   │ ipcRenderer.invoke / on (sarmalanmış)
┌──────────────────────────────────┴──────────────────────────────────────────┐
│                              RENDERER (React)                               │
│  pages/          features/                          stores/ (Zustand)       │
│  ├ Setup         ├ dashboard/  (stage list, live)   ├ appStore (env, conn)  │
│  ├ Projects      ├ findings/   (list, detail)       ├ projectStore          │
│  ├ Dashboard     ├ runs/       (history, recovery)  ├ providerStore         │
│  ├ Findings      ├ logs/       (viewer)             ├ runStore              │
│  ├ Runs          ├ settings/   (8 bölüm)            ├ findingsStore         │
│  ├ Logs          └ updates/    (banner)             └ settingsStore         │
│  └ Settings                                                                 │
└─────────────────────────────────────────────────────────────────────────────┘

shared/ (her iki taraf da kullanır; hiçbir process'e bağımlı değildir)
├ schemas/  project · provider · job · run · finding · cloud-api · ipc
├ types/    provider-adapter · state-machines
└ constants/ channels · providerIds · timeouts · protocolVersion
```

Ok yönleri: Renderer **yalnızca** preload'daki tipli API'yi çağırır. Main,
services katmanını kullanır. Services, Electron'a değil Node'a bağımlıdır
(test edilebilirlik için). `shared/` hiçbir katmana bağımlı değildir.

---

## 3. Main vs Renderer Responsibilities (Sorumluluk Ayrımı)

| İş | Main | Renderer |
|---|---|---|
| Dosya sistemi erişimi (proje okuma, pathGuard) | ✓ | ✗ |
| Child process (Claude/Codex CLI) başlatma/durdurma | ✓ | ✗ |
| Ağ istekleri (AI Factory Cloud) | ✓ | ✗ |
| SQLite okuma/yazma | ✓ | ✗ |
| Kimlik bilgisi (safeStorage) | ✓ | ✗ |
| Loglama + redaksiyon | ✓ | ✗ (yalnızca görüntüler) |
| Environment check (git, CLI tespiti, internet) | ✓ | ✗ (sonucu gösterir) |
| UI state (hangi sayfa açık, filtreler, görünüm modu) | ✗ | ✓ |
| Stage/progress/findings render'ı | ✗ | ✓ |
| Kullanıcı ayarları formu | ✗ (kalıcılaştırır) | ✓ (düzenler) |

Kural: Renderer'da `require`, `process`, `fs`, `child_process`, doğrudan
`fetch`-to-cloud **yoktur**. Renderer'ın dünyası `window.forgepilot.*` ile
sınırlıdır. Bu tablo Faz 13 güvenlik denetiminin kontrol listesidir.

```text
Karar     : Ağ istekleri dahil her yan etki main process'te.
Neden     : Tek denetim noktası — CSP + IPC şeması + redaksiyon aynı boru
            hattından geçer; renderer ele geçirilse bile yapabileceği şey
            preload'un açtığı tipli metodlarla sınırlı kalır.
Alternatif: Renderer'dan doğrudan HTTPS (CSP connect-src ile kısıtlı).
Trade-off : Her API çağrısı için IPC köprüsü yazmak ek iş; karşılığında token
            renderer'a hiç inmez ve tüm trafik tek yerden loglan/redakte edilir.
```

---

## 4. Core Modules (Çekirdek Modüller)

| Modül | Yol | Sorumluluk | Bağımlılık |
|---|---|---|---|
| App bootstrap | `src/main/app/` | Pencere, yaşam döngüsü, single-instance | — |
| Environment | `src/main/environment/` | İnternet, sunucu, Git, CLI, PATH, lisans kontrolü | providers, api |
| IPC katmanı | `src/main/ipc/` | Tüm kanallar; `defineIpcHandler(schema, fn)` deseni | shared/schemas |
| Security | `src/main/security/` | CSP, navigasyon koruması, credentialStore | — |
| Filesystem | `src/main/filesystem/` | `pathGuard` — proje sınırı zorlaması | — |
| Providers | `src/main/providers/` | Registry + Claude Code / Codex adaptörleri | process, shared/types |
| Process | `src/main/process/` | spawn sarmalayıcı, env allowlist, orphan reaper | filesystem |
| Logging | `src/main/logging/` | pino + redaksiyon dönüşümü | — |
| Updates | `src/main/updates/` | electron-updater yönetimi | api (version nego.) |
| Localization | `src/services/localization/` | Gömülü `en-US`, harici `.fplang` paketleri, fallback ve aktif locale yönetimi | shared/schemas, db |
| API client | `src/services/api/` | httpClient (HTTPS-only) + cloudApi (tipli endpoint'ler) | shared/schemas, security |
| Job service | `src/services/jobs/` | Sunucudan tek-adımlık directive alıp local/provider executor ile yürütme + heartbeat + recovery journal | api, process, providers |
| Run manager | `src/services/runs/` | Run durum makinesi, checkpoint, crash recovery, yerel doğrulayıcılar | db, jobs |
| Projects | `src/services/projects/` | Proje CRUD (repository deseni) | db |
| DB | `src/services/db/` | better-sqlite3 bağlantı + migrasyon | — |

Her modülün tek sahibi olan bir sorumluluğu vardır; "god class" yasaktır.
`services/` Electron API'si import etmez (birim test edilebilirlik).

---

## 5. Provider Abstraction (Sağlayıcı Soyutlaması)

Arayüz `src/shared/types/provider-adapter.ts` içinde, herhangi bir adaptör
yazılmadan önce donar:

```text
ProviderAdapter
├── isInstalled(): Promise<boolean>            // PATH + OS'a özgü konumlar
├── getVersion(): Promise<ProviderVersionInfo>
├── authenticate(): Promise<AuthStatus>        // durum SORGUSU; credential'a dokunmaz
├── getStatus(): Promise<ProviderStatus>       // not-installed|installed|authenticated|busy|error
├── createExecutionCommand(task): Promise<ProviderExecutionCommand>
│   ├── command                               // çözümlenmiş executable
│   ├── args[]                                // provider'a özgü güvenli argüman dizisi
│   └── input                                 // stdin üzerinden gönderilecek task body
└── dispose(): Promise<void>
```

- `TaskExecutionRequest`: buluttan gelen job talimatının normalize edilmiş hali —
  adaptör bunu CLI'ın kendi bayrak/stdin kurallarına çevirir.
- Process yaşam döngüsü, timeout ve stdout/stderr event üretimi `processManager` +
  `taskExecutionService` sorumluluğundadır; adaptör process state tutmaz.
- `authenticate()` **kimlik doğrulaması yapmaz**; CLI'ın kendi oturumunun durumunu
  sorgular (hafif komut veya config varlığı). ForgePilot sağlayıcı credential'ı
  asla okumaz/saklamaz — kullanıcı kendi Claude/Codex hesabıyla çalışır.

Kayıt deseni (`src/main/providers/registry.ts`):

```text
const ADAPTERS = [ClaudeCodeAdapter, CodexAdapter];   // 3. sağlayıcı = +1 satır
```

```text
Karar     : Davranışsal provider arayüzü TS interface, sınır verileri Zod şeması.
Neden     : Executable/argüman/stdin üretimi davranıştır; Task, Chunk, ExitInfo ve
            execution directive gibi sınır verileri ise runtime'da doğrulanmalıdır.
Alternatif: Her şeyi Zod ile modellemek.
Trade-off : İki mekanizma; karşılığında her biri doğru işte kullanılır.
```

```text
Karar     : Provider CLI komutu ve stdin sözleşmesinin TEK sahibi adaptördür.
Neden     : Claude/Codex CLI bayrakları sürümle değişebilir; provider farkları
            `jobService` veya UI içine yayılmaz. Process yaşam döngüsü ise ortak
            `taskExecutionService` içinde kalır.
Alternatif: Job service içinde provider adına göre CLI argümanı üretmek.
Trade-off : Adaptör sözleşmesi biraz daha davranışsaldır; çekirdek generic kalır.
```

---

## 6. Cloud API Contract (Bulut API Sözleşmesi)

Gerçek AI Factory Cloud bu deponun kapsamı dışındadır. Sözleşme
`src/shared/schemas/cloud-api.ts` içinde Zod ile tanımlanır, versiyonlanır ve
geliştirme boyunca **mock sunucu** (`pnpm dev:mock-cloud`) bu sözleşmeyi
implemente eder.

### Endpoint seti

```text
POST /session/handshake        // version negotiation + oturum açılışı
POST /session/refresh          // kısa ömürlü access token yenileme
GET  /workflows/current        // proje için aktif workflow + stage listesi
POST /executions/next          // stage için sıradaki tek directive; execution resume da aynı endpoint
POST /jobs/request             // legacy/manual tek job isteği; workflow sequencing kaynağı değildir
GET  /jobs/{id}                // Job durumu + Task talimatı
POST /jobs/{id}/heartbeat      // canlılık; sunucu tarafında timeout tespiti
POST /jobs/{id}/result         // normalize TaskResult + yerel doğrulama bulguları
POST /jobs/{id}/fail           // istemci-taraflı hata raporu (sınıflandırılmış)
POST /findings/sync            // finding lifecycle durum değişiklikleri (iki yönlü)
```

Bilinçli olarak **yoktur**: `/download-all-rules`, `/agents/export` benzeri
toplu-indirme endpoint'i. IP koruması API yüzeyinin kendisiyle zorlanır.

### Version negotiation (handshake gövdesi)

```json
{
  "desktopVersion": "0.2.1",
  "protocolVersion": "2",
  "supportedCapabilities": [
    "provider:claude-code",
    "provider:codex",
    "stage-execution:directives-v1"
  ]
}
```

Sunucu yanıtları: `ok` | `update-recommended` | `update-required`
(→ UI zorunlu güncelleme ekranına düşer, run başlatma kilitlenir).

### Workflow yanıtı (server-driven UI'ın kaynağı)

```json
{
  "workflowId": "software-factory-v8",
  "workflowVersion": "8.2",
  "stages": [
    { "id": "discovery", "name": "Discovery", "status": "completed" },
    { "id": "analysis",  "name": "Analysis",  "status": "running", "progress": 72,
      "currentAgent": "Architecture Analyzer",
      "currentOperation": "Analyzing authentication architecture..." }
  ]
}
```

İstemci stage listesini **olduğu gibi** render eder; stage id'lerine göre
dallanan hiçbir istemci mantığı yazılamaz.

### Server-driven execution directive protokolü

Stage çalıştırma sırasında desktop tüm workflow planını istemez. Bunun yerine
`POST /executions/next` ile yalnızca **sıradaki tek adımı** alır. İstek; proje,
provider, stage id, protocol capability'leri, desktop'ın desteklediği local
operation adları ve varsa bir önceki directive sonucunu taşır. Yanıt üç tipten
biridir:

- `local`: İsimlendirilmiş deterministic local operation + concrete input.
- `provider`: Tek bir provider job'ı + `verification|semantic` output contract.
- `terminal`: Stage için `completed|blocked|failed` kararı.

Stage sequencing, completion ve sonraki adıma geçme kararı sunucunun
sorumluluğundadır. Desktop yalnızca capability executor'dır. Böylece yeni bir
workflow/stage sırası yalnızca sunucu değişikliğiyle yayınlanabilir; desktop
`010-startup` / `020-discovery` gibi stage id'lerine göre dallanmaz. Proprietary
workflow'un tamamı da istemciye topluca gönderilmez.

Directive `id` değerleri execution içinde idempotency anahtarıdır. Desktop küçük
local operation sonuçlarını `.ai-factory/.forgepilot/execution-journal.json`
içinde saklayarak crash sonrası aynı directive yeniden verilirse local mutasyonu
tekrarlamak yerine sonucu yeniden sunucuya gönderebilir. Büyük Discovery hazırlık
payload'ları proje metnini çoğaltmamak için journal'a kopyalanmaz; bunlar replay-safe
şekilde yeniden hesaplanır. Task/prompt gövdeleri journal'a yazılmaz.

```text
Karar     : MVP'de REST + polling (job durumu ~2sn, workflow ~10sn); WebSocket
            "streaming" capability olarak sözleşmede rezerve edilir.
Neden     : Mock'lanması, test edilmesi, proxy/firewall geçişi kolay; canlı
            çıktının ana kaynağı zaten YEREL process stdout'u (ağ değil).
Alternatif: Baştan WebSocket/SSE.
Trade-off : Polling gecikmesi ve gereksiz istek; hacim düşük olduğu için kabul
            edilebilir. Capability alanı sayesinde geçiş kırılma yaratmaz.
```

```text
Karar     : Heartbeat istemciden sunucuya, job başına, 30sn aralıkla.
Neden     : Desktop çökerse sunucu job'ı "stalled" işaretleyip kurtarma
            politikası uygulayabilir; crash recovery'nin sunucu ayağı budur.
Alternatif: Sunucunun istemciyi yoklaması (NAT/firewall ardında imkânsız).
Trade-off : Ek trafik (ihmal edilebilir).
```

---

## 7. Run / Stage / Job State Machine (Durum Makineleri)

Üç kavram ayrıdır: **Run** = kullanıcının başlattığı uçtan uca bir AI Factory
çalıştırması. **Stage** = sunucunun tanımladığı workflow aşaması. **Job** =
sunucu ile desktop arasındaki atomik iş birimi. Bir Run birden çok Stage,
bir Stage birden çok Job içerebilir.

### Run (istemcinin sahibi olduğu makine — `services/runs/runManager.ts`)

```text
idle ──start──▶ preparing ──▶ running ──▶ completed
                  │             │ ▲
                  │       pause │ │ resume
                  │             ▼ │
                  │           paused ──cancel──▶ cancelled
                  │             │
                  ▼             ▼
                failed ◀──── (hata)      (çökme) ──▶ interrupted
                                                        │ açılışta tespit
                                                        ▼
                                              [Resume] → running
                                              [Discard] → discarded
```

- `preparing`: env-check + workflow çekme + provider hazırlığı.
- Her durum geçişi SQLite `runs` tablosuna **checkpoint** yazılır (crash
  recovery bunun üstüne kurulur, §10).
- `pause`: aktif job tamamlanana kadar bekler, yeni job istemez (CLI process'i
  ortasından dondurulmaz — güvenilir değil); `cancel`: aktif process'e önce
  SIGTERM, süre dolarsa kill; her iki yolda da sunucuya `/jobs/{id}/fail`
  (reason: `user-cancelled`) bildirilir.

### Stage (sunucunun sahibi, istemci yalnızca render eder)

```text
waiting ─▶ ready ─▶ running ─▶ completed
                       │
                       ├─▶ failed
                       └─▶ skipped
```

İstemci stage durumunu **değiştirmez**; `GET /workflows/current` yanıtını
yansıtır. UI ikonları: completed `✓` · running `●` · waiting `○` · failed `✕`.

### Job (istemci-sunucu ortak makinesi — `services/jobs/jobService.ts`)

```text
requested ─▶ received ─▶ executing ─▶ validating ─▶ submitting ─▶ acked
                │            │                          │
                │            │ (heartbeat 30sn döngüsü) │ (ağ hatası)
                ▼            ▼                          ▼
              failed ◀── timeout/provider hatası    retry (backoff, maks 3)
                │                                       │
                └──────── POST /jobs/{id}/fail ◀────────┘ (tükendi)
```

- `executing`: adaptör `createExecutionCommand()` ile provider-specific komutu
  üretir; `taskExecutionService` / `processManager` process yaşam döngüsü ve
  stdout/stderr akışını yönetir. Task gövdesi stdin üzerinden iletilir. Job timeout
  aşılırsa process durdurulur ve sonuç `timeout` olur.
- `validating`: yerel doğrulayıcılar (exit code, dosya diff'i, çıktı şeması) —
  yalnızca **mekanik** kontroller; kalite puanlaması sunucunundur.

```text
Karar     : Pause, "job sınırında duraklat" olarak tanımlanır (process freeze değil).
Neden     : CLI process'ini SIGSTOP ile dondurmak sağlayıcı oturum/timeout
            davranışlarını bozar ve Windows'ta güvenilir değildir.
Alternatif: Gerçek process suspend.
Trade-off : Pause anlık değildir (aktif job biter); UI "Pausing…" ara durumu
            gösterir. Öngörülebilirlik kazanılır.
```

---

## 8. Local Storage Model (Yerel Depolama)

Konum: `app.getPath('userData')` → `%AppData%/forgepilot/`

```text
forgepilot/
├── forgepilot.db      (SQLite, yalnızca main process)
├── logs/              (rotasyonlu .log dosyaları)
└── cache/             (geçici; her açılışta budanır)
```

### SQLite şeması (better-sqlite3, migrasyonlu)

| Tablo | İçerik | Not |
|---|---|---|
| `projects` | id, name, rootPath, gitRemote, branch, lastOpenedAt, providerId | |
| `runs` | id, projectId, workflowId+version, providerId, status, startedAt, finishedAt, durationMs, findingsCount, **checkpoint** (son stage/job id) | crash recovery kaynağı |
| `jobs` | id, runId, stageId, status, exitCode, startedAt, finishedAt | geçmiş/teşhis |
| `findings_cache` | id, runId, severity, title, file, line, stageId, agent, status, syncedAt | **cache** — otorite sunucu |
| `settings` | key, value(json) | UI tercihleri, sunucu URL |
| `logs_index` | ts, level, category, file-offset | log görüntüleyici araması |

Kurallar:

- **Sunucu source of truth**: `findings_cache`, workflow, stage verileri
  önbellektir; çakışmada sunucu kazanır. Yerel otorite yalnızca: proje listesi,
  kullanıcı ayarları, run geçmişi, loglar.
- **Asla diske yazılmaz**: prompt metinleri, rule/agent/skill içerikleri,
  sunucudan gelen talimat gövdeleri. Provider task body yalnızca bellekte yaşar
  ve stdin ile CLI'a aktarılır. Recovery journal yalnız execution id ile küçük
  local deterministic sonuçları tutar; provider instruction/output gövdesini tutmaz.
- Saklama politikası: run/job/log kayıtları 90 gün veya 500MB sınırında budanır
  (Settings → Advanced'ten ayarlanabilir).
- Kimlik bilgisi DB'ye girmez: AI Factory token'ı `safeStorage` ile şifrelenmiş
  ayrı blob'dadır (§9).

```text
Karar     : Job talimat gövdesi kalıcılaştırılmaz; interrupted run "Resume"
            edildiğinde talimat sunucudan YENİDEN istenir.
Neden     : IP koruması (proprietary prompt diskte kalmaz) + sunucu talimatı
            bu arada güncellemiş olabilir.
Alternatif: Şifreli yerel kopya.
Trade-off : Resume offline çalışmaz — zaten offline'da yeni execution yok (§18
            prensibi), tutarlı.
```

---

## 9. Security Architecture (Güvenlik Mimarisi)

Katman katman:

1. **Electron sertleştirme**: `contextIsolation: true`, `nodeIntegration: false`,
   `sandbox: true`, `webSecurity: true`; CSP `default-src 'self'`, `unsafe-eval`
   yok; `will-navigate`/`setWindowOpenHandler` allowlist dışına kapalı. CI'da
   regresyon testi (bayraklar her PR'da assert edilir).
2. **IPC doğrulama**: Her kanal `defineIpcHandler(schema, fn)` üzerinden; girdi
   VE çıktı Zod ile doğrulanır. Preload yalnızca tipli metodlar açar; ham
   `ipcRenderer` asla sızmaz. Kanal envanteri `shared/schemas/ipc.ts`'de tek
   yerde denetlenebilir.
3. **Dosya sistemi sınırı**: `pathGuard` — her dosya erişimi seçili proje kökü
   içinde mi (realpath ile symlink/traversal/UNC kontrolü). Proje dışına erişim
   yok; "gereksiz dosya toplamama" gizlilik ilkesinin teknik karşılığı.
4. **Process güvenliği**: Asla `shell: true` / string birleştirme; yalnızca
   `spawn`/`execFile` + argüman dizisi. Env allowlist (üst process env'i körü
   körüne miras alınmaz). Orphan reaper: `before-quit` + açılışta PID dosyası
   kontrolü ile sahipsiz CLI process'leri temizlenir.
5. **Kimlik bilgisi**: AI Factory access token kısa ömürlü; refresh token
   `safeStorage` (Windows DPAPI / macOS Keychain / libsecret) ile şifreli.
   Düz metin credential dosyası yok. Sağlayıcı credential'larına hiç dokunulmaz.
6. **Ağ**: HTTPS-only (tek istisna: açık `localhost` dev bayrağı ile mock
   sunucu). Sertifika hatasında sessiz fallback yok. Tüm bulut trafiği main
   process'teki tek `httpClient`'tan geçer.
7. **Log redaksiyonu**: Her log satırı redaksiyon dönüşümünden geçer — desen
   bazlı (bearer/API-key şekilleri) + alan adı kara listesi (`token`,
   `password`, `apiKey`, `authorization`) + CLI stdout/stderr'i de dahil.

Tehdit modeli özeti:

| Tehdit | Karşılık |
|---|---|
| Renderer XSS → sistem erişimi | contextIsolation + sandbox + dar preload API |
| Kötücül job talimatı → proje dışı yazma | pathGuard + cwd kilidi + env allowlist |
| Token sızıntısı (log/disk) | safeStorage + redaksiyon + DB'ye credential yazmama |
| MITM | HTTPS-only, sertifika doğrulama, fallback yok |
| IP hırsızlığı (EXE söküm) | Proprietary içerik EXE'de/diske hiç yok (mimari garanti) |
| Orphan CLI process kaynak tüketimi | reaper + timeout + before-quit temizliği |

---

## 10. Error & Recovery Strategy (Hata ve Kurtarma)

### Hata sınıfları

| Sınıf | Örnek | Politika |
|---|---|---|
| Ağ (geçici) | timeout, 5xx | Exponential backoff, maks 3 deneme; sonra kullanıcıya banner |
| Ağ (kalıcı) | sunucu kapalı | Degraded mode (§18-prensibi): veriler görünür, yeni run kilitli |
| Auth | 401/403 | Token refresh → olmadıysa oturum ekranına düşür |
| Protokol | `update-required` | Zorunlu güncelleme ekranı, run kilitli |
| Sağlayıcı | CLI yok / auth yok | Environment Check ekranına yönlendir, talimat göster |
| Process | timeout, sıfır-dışı exit | Job `failed`, `/jobs/{id}/fail` ile raporla, run sunucu kararına göre devam/durur |
| Doğrulama | IPC/API şema uyuşmazlığı | Log + kullanıcıya "sürüm uyumsuzluğu olabilir" uyarısı |

### Crash recovery akışı

1. Run yaşarken her durum geçişi `runs.checkpoint`'e yazılır (senkron, ucuz).
2. Uygulama açılışında: `status IN ('running','preparing','pausing')` kayıt
   var mı? → varsa Run `interrupted` işaretlenir ve diyalog gösterilir:

```text
┌─────────────────────────────────────────┐
│  Yarım kalmış bir AI Factory çalışması  │
│  bulundu.                               │
│                                         │
│  Proje      : My SaaS                   │
│  Son aşama  : Analysis                  │
│  Kesilme    : 13 Ağu 2026 14:47        │
│                                         │
│        [ Devam Et ]   [ Vazgeç ]        │
└─────────────────────────────────────────┘
```

3. **Devam Et**: sunucuya handshake → `GET /jobs/{lastJobId}` ile job'ın sunucu
   tarafındaki gerçek durumu öğrenilir (sunucu heartbeat kesildiği için zaten
   stalled işaretlemiş olabilir) → sunucunun dediği noktadan devam.
4. **Vazgeç**: Run `discarded`; sunucuya `/jobs/{id}/fail` (reason:
   `discarded-after-crash`).
5. Açılışta orphan reaper: önceki oturumdan kalan PID'ler kontrol edilir,
   yaşayan sahipsiz CLI process'leri sonlandırılır.

```text
Karar     : Kurtarmada otorite sunucudur (istemci checkpoint'i yalnızca "neyi
            soracağını" söyler).
Neden     : Desktop çökmüşken sunucu job'ı yeniden atamış/iptal etmiş olabilir;
            istemcinin körlemesine devam etmesi çift çalıştırma yaratır.
Alternatif: Yerel checkpoint'ten doğrudan devam.
Trade-off : Resume için ağ şart — §8'deki kararla tutarlı.
```

---

## 11. Update Strategy (Güncelleme Stratejisi)

İki değişiklik sınıfı, iki ayrı yol — mimarinin temel ayrımı:

| Değişiklik | Mekanizma | EXE update? |
|---|---|---|
| Yeni rule / prompt / agent / workflow / scoring | Sunucu tarafında yayınlanır; istemci sonraki `GET /workflows/current` / job'da otomatik alır | **Hayır** |
| Yeni UI, yeni provider adaptörü, güvenlik yaması, native yetenek | electron-updater ile imzalı sürüm | **Evet** |

Akış:

1. Açılışta + günlük zamanlanmış kontrol: GitHub Releases feed'i (electron-updater).
2. Güncelleme varsa indirilir, **kullanıcıya sorulmadan asla kurulmaz** —
   UpdateBanner: "Güncelleme hazır — Yeniden başlat".
3. Handshake `update-required` dönerse: banner değil kilit ekranı; yeni run
   başlatılamaz, mevcut veriler görüntülenebilir (degraded moda benzer).
4. Tüm güncelleme olayları loglanır (şeffaflık ilkesi).

```text
Karar     : Feed olarak GitHub Releases.
Neden     : Depo zaten açık kaynak GitHub'da; imzalı artefakt + latest.yml
            electron-updater ile standart; ek altyapı sıfır.
Alternatif: Kendi statik update sunucusu.
Trade-off : GitHub kesintisine bağımlılık (nadir, kabul edilebilir); ileride
            kurumsal dağıtım gerekirse generic provider'a geçiş kolay.
```

---

## 12. MVP Scope (MVP Kapsamı)

### MVP'ye girer (BUILD_PLAN Faz 0–7'nin çekirdeği)

- Electron kabuğu + tam güvenlik temeli (bu pazarlık dışı, MVP'de bile)
- Environment Check ekranı: internet, mock-sunucu, Git, **Claude Code** tespiti
- Proje ekleme/listeleme/açma (native klasör seçici, pathGuard)
- **Tek sağlayıcı**: Claude Code adaptörü (tespit + çalıştırma)
- Mock bulut sunucusuyla tam job döngüsü: request → execute → validate →
  result (heartbeat dahil)
- Server-driven stage listesi render'ı (mock workflow ile)
- Canlı çıktı akışı (Developer View), başlat/durdur (Stop)
- Temel findings listesi (severity + dosya/satır; lifecycle YOK, salt görüntüleme)
- Run kaydı (başlangıç/bitiş/durum) — geçmiş listesi basit tablo
- Loglama + redaksiyon + basit log görüntüleyici

### MVP'ye girmez (MVP-sonrası, sıralı)

1. Codex adaptörü (arayüz hazır; implementasyon post-MVP)
2. Pause/Resume (MVP'de yalnız Stop var)
3. Crash recovery diyaloğu (checkpoint altyapısı MVP'de yazılır, UI sonra)
4. Findings lifecycle (Open→…→Reopened) + sunucu senkronu + filtreler
5. Simple View (MVP tek görünüm: Developer View)
6. Auto-update (MVP elle dağıtılır)
7. Version negotiation'ın `update-required` kilidi (handshake alanları baştan
   sözleşmede — davranış sonra)
8. WebSocket streaming, Settings'in tamamı (MVP'de yalnız Server URL + Provider durumu)

```text
Karar     : MVP tek sağlayıcı (Claude Code), ama adaptör arayüzü + registry
            ilk günden çok-sağlayıcılı.
Neden     : Soyutlamanın maliyeti düşük, sonradan eklemenin maliyeti yüksek;
            Codex "bir dosya ekle" işine iner.
Alternatif: MVP'de iki sağlayıcı.
Trade-off : MVP kapsamı küçülür, teslim hızlanır; ikinci sağlayıcı gecikir.
```

---

## 13. Recommended Folder Structure (Klasör Yapısı)

BUILD_PLAN ile birebir aynı iskelet + bu dokümanın eklediği modüller (⊕):

```text
src/
├── main/
│   ├── app/            (main.ts, window.ts, lifecycle)
│   ├── environment/  ⊕ (envCheck, gitDetect, netCheck)
│   ├── ipc/            (registerHandler + kanal dosyaları: projects, providers,
│   │                    tasks, jobs, runs ⊕, findings ⊕, logs, updates, settings ⊕)
│   ├── providers/      (registry, claudeCodeAdapter, codexAdapter)
│   ├── process/        (processManager, orphanReaper ⊕)
│   ├── filesystem/     (pathGuard)
│   ├── security/       (csp, navGuard, credentialStore)
│   ├── logging/        (logger, redact)
│   └── updates/        (updateManager)
├── preload/
│   └── index.ts        (window.forgepilot.* — tek tipli yüzey)
├── renderer/
│   ├── pages/          (Setup ⊕, Projects, Dashboard, Findings, Runs ⊕, Logs, Settings)
│   ├── components/     (StageList ⊕, SeverityBadge ⊕, StatusBar ⊕, ...)
│   ├── features/       (dashboard ⊕, findings, runs ⊕, logs, settings, updates)
│   └── stores/         (app ⊕, project, provider, run, findings ⊕, settings)
├── shared/
│   ├── types/          (provider-adapter, state-machines ⊕)
│   ├── schemas/        (project, provider, job, run ⊕, finding, cloud-api, ipc)
│   └── constants/      (channels, providerIds, timeouts, protocolVersion ⊕)
└── services/
    ├── api/            (httpClient, cloudApi)
    ├── jobs/           (jobService, heartbeat ⊕)
    ├── runs/           (runManager ⊕, validators, validationPipeline)
    ├── projects/       (projectRepository)
    └── db/             (connection, schema, migrations)

tools/
└── mock-cloud/         (Fastify mock — cloud-api.ts sözleşmesini implemente eder)
```

---

## 14. Technical Risks (Teknik Riskler)

| # | Risk | Etki | Azaltma |
|---|---|---|---|
| 1 | Claude/Codex CLI çıktı formatı sürümle kırılır | Job'lar parse edilemez | Normalize etme yalnızca adaptörde; adaptör başına sürüm-uyum testi; `getVersion()` ile bilinen-uyumsuz sürümde kullanıcı uyarısı |
| 2 | Gerçek Cloud API henüz yok; sözleşme varsayım | Entegrasyonda sapma | Zod sözleşmesi + versiyon sabiti + mock sunucu; sözleşme testleri sonradan gerçek sunucuya da koşulur |
| 3 | better-sqlite3 native modül paketleme (3 OS) | Build kırılması | Faz 9'da erken CI doğrulaması; @electron/rebuild; gerekirse saf-JS fallback değerlendirilir |
| 4 | Uzun CLI oturumlarında çıktı hacmi (bellek/backpressure) | UI donması, OOM | Ring-buffer (son N satır UI'da), tam akış rotasyonlu log dosyasına; IPC'ye toplu (batched) gönderim |
| 5 | Windows PATH/izin uç durumları (kurumsal makineler, OneDrive yolları) | Tespit/çalıştırma hatası | PATH + bilinen konum taraması; envCheck'te açık hata mesajı + "talimat göster"; UNC/uzun-yol testleri |
| 6 | Heartbeat/poll ile pil-arka plan davranışı (laptop uyku) | Sahte "stalled" | Uyku/uyanma olaylarında (powerMonitor) heartbeat'i hemen tetikle + sunucuya `resumed-from-sleep` bilgisi |
| 7 | Kod imzalama sertifikası gecikmesi | SmartScreen uyarıları | Faz 12'de "imzasız-belgeli" dağıtım yolu; sertifika CI secret olarak sonradan eklenir |

---

## 15. Implementation Order (Uygulama Sırası)

Sıralama [BUILD_PLAN.md](BUILD_PLAN.md) fazlarını takip eder; bu dokümanın
eklediği işlerin faz eşlemesi:

| BUILD_PLAN fazı | Bu dokümandan eklenen işler |
|---|---|
| Faz 1 (Kabuk + Güvenlik) | `main/environment/` iskeleti; orphanReaper iskeleti |
| Faz 2 (Sözleşmeler) | `run` şeması, state-machine tipleri, finding lifecycle enum, `protocolVersion` sabiti, cloud-api'ye heartbeat/fail/handshake |
| Faz 3 (Projeler) | Proje kartına git branch/remote tespiti (envCheck'in git modülüyle) |
| Faz 4 (Sağlayıcı tespiti) | `authenticate()` durumu; Environment Check ekranı (Setup page) |
| Faz 5 (Süreç çalıştırma) | Provider command contract + ortak process lifecycle; ring-buffer + batched IPC; Stop akışı |
| Faz 6 (Bulut istemcisi) | handshake/version-negotiation, heartbeat döngüsü, `/fail`, `GET /workflows/current`, degraded-mode banner |
| Faz 7 (Doğrulama + UI) | Dashboard (stage render + progress + live activity), findings listesi; **Run manager + checkpoint + run geçmişi burada eklenir** |
| Faz 8 (Loglama) | logs_index + görüntüleyici filtreleri |
| Faz 9 (SQLite) | `runs`/`jobs`/`findings_cache` tabloları, saklama politikası |
| Faz 10 (Güncelleme) | `update-required` kilit ekranı |
| MVP-sonrası | Codex adaptörü, Pause/Resume, crash-recovery diyaloğu, findings lifecycle senkronu, Simple View, WebSocket |

---

## 16. UI / Ekran Tasarımı

Tasarım dili: developer-tool estetiği (IDE companion hissi), bilgi-yoğun ama
sade, animasyonsuz, koyu/açık tema desteği. Web sitesi değil, masaüstü uygulaması.

### 16.1 Uygulama kabuğu

```text
┌──────────────────────────────────────────────────────────────────┐
│ ⬢ ForgePilot      ● Cloud: Connected   Provider: Claude   v1.4.2 │ ← durum çubuğu
├───────────┬──────────────────────────────────────────────────────┤
│ Projects  │                                                      │
│ Dashboard │                                                      │
│ Findings  │                (aktif sayfa içeriği)                 │
│ Runs      │                                                      │
│ Logs      │                                                      │
│           │                                                      │
│ Settings  │                                                      │
└───────────┴──────────────────────────────────────────────────────┘
```

- Sol navigasyon: proje bağlamı seçilmeden Dashboard/Findings/Runs devre dışı.
- Durum çubuğu: bulut bağlantısı (● yeşil/kırmızı), aktif sağlayıcı, sürüm.
  Bağlantı koptuğunda çubuğun altında degraded-mode banner'ı belirir:

```text
⚠ AI Factory Cloud'a ulaşılamıyor. Mevcut proje bilgileri görüntülenebilir;
  yeni çalıştırma başlatılamaz.                            [Tekrar Dene]
```

### 16.2 İlk Açılış — Environment Check (Setup sayfası)

İlk açılışta ve Settings→"Run Environment Check" ile:

```text
ENVIRONMENT CHECK

AI Factory Server        ✓ Connected (v8.2, protocol 3)
Internet                 ✓ Available
License / Session        ✓ Valid until 2027-01-01
Git                      ✓ 2.46.0
Claude Code              ✓ 2.1.3 · Authenticated
Codex                    ✕ Not installed

                         [ Installation Instructions ]  [ Check Again ]

Selected Provider:  (•) Claude Code   ( ) Codex (unavailable)

                                              [ Continue → Projects ]
```

- Her satır `main/environment/` kontrollerinin canlı sonucudur.
- ✕ satırına tıklayınca sağ panelde kurulum talimatı (statik metin + resmi
  link; link OS tarayıcısında açılır — uygulama içinde web sayfası açılmaz).
- Sunucu yoksa "Continue" yine mümkündür (degraded mod) ama run başlatılamaz.

### 16.3 Projects

```text
PROJECTS                                              [ + Add Project ]

┌────────────────────────────────────────────────────────────────┐
│ My SaaS App                                   Claude Code      │
│ C:\Projects\my-saas · git: main · Son çalışma: 2 saat önce     │
│ AI Factory: READY                              [ Open ]        │
├────────────────────────────────────────────────────────────────┤
│ Internal CRM                                  Codex            │
│ D:\Development\crm · git: develop · Son çalışma: 3 gün önce    │
│ AI Factory: NEVER RUN                          [ Open ]        │
└────────────────────────────────────────────────────────────────┘
```

- "+ Add Project": native klasör seçici → pathGuard doğrulaması → git tespiti
  (varsa branch/remote gösterilir; yoksa "no git" rozeti — engel değildir).
- Kart sağ-tık menüsü: Open · Reveal in Explorer · Remove (yalnızca listeden
  çıkarır, diskten silmez — diyalogda açıkça yazar).

### 16.4 Dashboard (proje açıkken ana ekran)

```text
AI FACTORY                                    Project: My SaaS · main
Provider: Claude Code                         Status: RUNNING

STAGES                          ─────────────────────────────────────
Discovery        ✓ Completed    │ CURRENT STAGE                     │
Context          ✓ Completed    │ ANALYSIS                          │
Analysis         ● Running      │                                   │
Architecture     ○ Waiting      │ ████████████░░░░  72%             │
Database         ○ Waiting      │                                   │
API              ○ Waiting      │ Agent: Architecture Analyzer      │
Implementation   ○ Waiting      │ Op: Analyzing authentication...   │
Validation       ○ Waiting      ─────────────────────────────────────

FINDINGS   Critical 1 · High 3 · Medium 7 · Low 12       [View All →]

LIVE ACTIVITY                              [ Simple ▾ | Developer ]
14:32:11  Reading repository structure
14:32:14  Found 142 source files
14:32:19  Analyzing authentication system
14:32:40  3 potential issues detected

                                    [ Pause ]  [ Stop ]
```

- Stage listesi **tamamen sunucu verisinden** render edilir (id/ad/durum/sıra);
  istemcide sabit stage adı yoktur.
- Progress, agent adı, operasyon metni: workflow yanıtındaki alanlardan.
- **Simple View**: yalnız stage listesi + progress + findings sayacı (log yok).
- **Developer View**: + canlı stdout/stderr akışı (ring-buffer, son 2000 satır;
  tamamı log dosyasında), + job id/exit-code detayları.
- Pause → "Pausing… (aktif işlem tamamlanıyor)" ara durumu; Stop → onay
  diyaloğu ("Çalışan işlem iptal edilecek").
- Run yokken bu ekran "hazır" halidir: stage listesi (workflow önizlemesi) +
  büyük `[ Start AI Factory Run ]` butonu + provider/env özeti.

### 16.5 Findings

```text
FINDINGS — My SaaS                     Run: #184 (son) ▾
Filtre: [Severity ▾] [Stage ▾] [Status ▾] [Agent ▾] [dosya ara____]

┌─ HIGH ─────────────────────────────────────────────┐  ┌─ DETAY ──────────────┐
│ Authentication token validation missing            │  │ HIGH · Open ▾        │
│ src/api/auth.ts:182 · Security Analysis            │  │                      │
├─ MEDIUM ───────────────────────────────────────────┤  │ File: src/api/       │
│ Unbounded query in listUsers                       │  │   auth.ts:182        │
│ src/api/users.ts:64 · Analysis                     │  │ Stage: Security      │
├─ ...                                               │  │ Agent: Auth Analyzer │
└────────────────────────────────────────────────────┘  │                      │
                                                        │ Description: ...     │
Critical 1 · High 3 · Medium 7 · Low 12 · Info 21       │ Recommendation: ...  │
                                                        │ [Open in editor]     │
                                                        └──────────────────────┘
```

- Durum değiştirme (detay panelindeki `Open ▾`):
  `Open → Acknowledged → In Progress → Resolved / Ignored`, kapalıysa `Reopen`.
  Değişiklik önce yerel cache'e, sonra `POST /findings/sync` ile sunucuya;
  senkron başarısızsa satırda "not synced" rozeti (tekrar dener).
- "Open in editor": `file:line` → kullanıcının varsayılan editörüne (yalnızca
  proje kökü içindeki dosyalar — pathGuard).

### 16.6 Runs

```text
RUNS — My SaaS

#   Başlangıç          Süre     Workflow                Durum        Bulgu
184 13 Ağu 14:31      18m 42s  software-factory-v8.2   Completed    29
183 12 Ağu 09:15      22m 03s  software-factory-v8.2   Cancelled    11
182 11 Ağu 16:40      —        software-factory-v8.1   Interrupted  4
```

- Satır tıklaması → run detayı: stage zaman çizelgesi, job listesi (id, durum,
  exit code, süre), o run'ın bulguları, o run'ın log dilimi.
- `Interrupted` satırında `[Resume] [Discard]` (crash recovery, §10).

### 16.7 Logs

```text
LOGS                      [DEBUG ✓][INFO ✓][WARN ✓][ERROR ✓][FATAL ✓]  [ara___]  [Export]

14:32:11.204  INFO   job      job_839127 started (stage: analysis)
14:32:11.310  DEBUG  process  spawn claude [args-redacted-count: 4]
14:32:40.020  WARN   validate expected file not modified: src/db/schema.ts
```

- Kaynak: rotasyonlu log dosyaları + `logs_index`; canlı takip (follow) modu.
- Export: redaksiyondan **geçmiş** halin kopyası (ham sır asla dışarı çıkmaz).

### 16.8 Settings (8 bölüm)

| Bölüm | İçerik |
|---|---|
| **General** | Dil, tema (koyu/açık/sistem), açılışta son projeyi aç |
| **Providers** | Sağlayıcı başına: Installed ✓/✕, sürüm, auth durumu, [Re-detect]; varsayılan sağlayıcı seçimi |
| **Projects** | Kayıtlı proje listesi yönetimi, varsayılan klasör, saklama |
| **Server** | AI Factory URL (kurumsal için değiştirilebilir), bağlantı testi, protokol/sürüm bilgisi, oturum: [Sign out] |
| **Security** | Kimlik bilgisi durumu (safeStorage aktif mi), IPC/CSP bilgi kutusu (salt-okunur şeffaflık), proje sınırı açıklaması |
| **Logs** | Log seviyesi, saklama süresi/boyutu, klasörü aç, temizle |
| **Updates** | Sürüm, kanal, otomatik kontrol aç/kapa, [Check now], sürüm notları |
| **Advanced** | Veri saklama limitleri (gün/MB), cache temizle, mock-server dev bayrağı (yalnızca dev build'de görünür), teşhis paketi dışa aktar |

### 16.9 Diyaloglar ve boş durumlar

- **Kurtarma diyaloğu**: §10'daki mockup.
- **Stop onayı**: "Çalışan Claude Code işlemi sonlandırılacak. Devam?" —
  [İptal] [Durdur]. Zorla kapatma yalnızca nazik kapatma zaman aşımına uğrarsa.
- **Update kilidi** (`update-required`): tam sayfa — "Bu istemci sürümü sunucu
  tarafından desteklenmiyor. Güncelleme gerekli." [Update Now].
- Boş durumlar: Projects boş → "Henüz proje yok" + büyük Add butonu; Findings
  boş → "Bu run'da bulgu yok ✓"; Runs boş → "İlk çalıştırmayı Dashboard'dan başlat".

---

## 17. Localization / Language Pack Modeli

ForgePilot multi-language çalışır; ancak varsayılan dil `en-US` uygulamanın
içinde gelir. Bu sayede kullanıcı hiçbir dil paketi yüklemese bile uygulama
kurulur, açılır, hata mesajı gösterebilir ve Settings ekranına ulaşabilir.

`en-US` dışındaki diller EXE içine gömülmez. Bu diller `.fplang` uzantılı, ZIP
tabanlı ve JSON içerikli language pack olarak yüklenir.

```text
tr-TR.fplang
├─ manifest.json
├─ common.json
├─ renderer.json
├─ errors.json
├─ settings.json
└─ providers.json
```

`manifest.json` alanları Zod ile doğrulanır:

```json
{
  "id": "tr-TR",
  "name": "Türkçe",
  "version": "1.0.0",
  "forgepilotProtocol": "1",
  "direction": "ltr",
  "fallback": "en-US",
  "checksum": "...",
  "signature": "..."
}
```

Kurallar:

- Paketler yalnızca JSON ve manifest içerir; JavaScript, HTML, executable veya
  shell komutu içeremez.
- Main process paketi açar, manifest'i ve çeviri gövdelerini doğrular, checksum
  ve imza kontrolü yapar.
- Renderer çeviri dosyalarını doğrudan okumaz; preload üzerinden tipli IPC
  çağrılarıyla aktif çevirileri alır.
- Production build'de imzasız paket aktif edilemez. Dev build'de imzasız paket
  yalnızca açık geliştirme bayrağıyla test edilebilir.
- Eksik key varsa önce paketin `fallback` locale'ine, en sonda gömülü `en-US`
  kaynaklarına düşülür.
- Aktif locale ve yüklü paket manifest metadata'sı settings içinde saklanır;
  çeviri gövdeleri SQLite'a kopyalanmaz.
- RTL diller için `direction: "rtl"` desteklenir ve renderer root yönü bu
  metadata'dan ayarlanır.
- AI Factory Cloud ileride opsiyonel language pack katalog metadata'sı sunabilir;
  katalog yokken yerel yükleme ve gömülü `en-US` çalışmaya devam eder.

```text
Karar     : `en-US` gömülü varsayılan; diğer diller harici `.fplang` paketi.
Neden     : Uygulama paketsiz açılabilir kalır, EXE çeviri şişmesini taşımaz ve
            yeni diller uygulama rebuild gerektirmeden dağıtılabilir.
Alternatif: Tüm dilleri EXE içine gömmek.
Trade-off : Paket doğrulama ve fallback altyapısı gerekir; karşılığında daha
            güvenli, güncellenebilir ve genişletilebilir localization modeli oluşur.
```

---

## Ek: Karar Kaydı Özeti

| Karar | Bölüm |
|---|---|
| Tüm yan etkiler main process'te; renderer yalnız tipli IPC | §3 |
| Adaptör = CLI normalizasyonunun tek yeri | §5 |
| REST+polling ile başla, WebSocket capability olarak rezerve | §6 |
| Heartbeat istemciden, 30sn, job başına | §6 |
| Pause = job sınırında; process freeze yok | §7 |
| Job talimatı diske yazılmaz; resume talimatı yeniden ister | §8 |
| Crash kurtarmada otorite sunucu | §10 |
| Update feed: GitHub Releases | §11 |
| MVP tek sağlayıcı, çok-sağlayıcılı arayüzle | §12 |
| `en-US` gömülü varsayılan; diğer diller harici `.fplang` paketi | §17 |
