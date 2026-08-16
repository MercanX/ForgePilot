# ForgePilot Geliştirme

Bu depo pnpm workspace kullanan tek paketli bir Electron, Vite, React ve
TypeScript uygulaması olarak yapılandırılmıştır.

## Gereksinimler

- Node.js 24
- Corepack

`pnpm` PATH içinde yüklü değilse komutları `corepack pnpm ...` biçiminde çalıştırın.

## Kurulum

```bash
corepack pnpm install
```

## Geliştirme

```bash
corepack pnpm dev
```

Bu komut Electron-Vite geliştirme sunucusunu başlatır ve ForgePilot penceresini
açar.

`dev` script'i küçük bir launcher üzerinden çalışır ve `ELECTRON_RUN_AS_NODE`
ortam değişkenini child process ortamından silerek Electron'un Node modu yerine
normal masaüstü uygulaması olarak açılmasını garanti eder.

DevTools normal geliştirme açılışında otomatik açılmaz. Gerekirse şu ortam
değişkeniyle açık başlatılabilir:

```bash
FORGEPILOT_OPEN_DEVTOOLS=1 corepack pnpm dev
```

PowerShell:

```powershell
$env:FORGEPILOT_OPEN_DEVTOOLS='1'; corepack pnpm dev
```

## Temiz Dev Yeniden BaÅŸlatma

Electron, renderer dev server ve mock cloud sÃ¼reÃ§lerini tek komutla kapatÄ±p
temiz mock state ile yeniden baÅŸlatmak iÃ§in:

```powershell
powershell -ExecutionPolicy Bypass -File tools\restart-dev.ps1
```

## Mock Cloud

Faz 6 ile birlikte yerel AI Factory mock cloud server eklenmiştir. Dev app'i
ayrı bir terminalde açıkken mock cloud'u şu komutla başlatın:

```bash
corepack pnpm dev:mock-cloud
```

Varsayılan adres `http://localhost:4317` olarak kullanılır. Bu HTTP adresi
yalnızca localhost geliştirme istisnasıdır; gerçek cloud URL'leri HTTPS olmak
zorundadır.

Desktop ve mock cloud aynı protokol sürümünden gelmelidir. ForgePilot 0.2.1
protocol v2 kullanır; eski 0.1.x mock cloud process'i 4317 portunda açık kalırsa
yeni desktop bunu handshake sırasında açık bir protocol mismatch hatasıyla
reddeder. Böyle bir durumda eski mock cloud terminalini kapatıp bu repo
kopyasından `corepack pnpm dev:mock-cloud` komutunu yeniden çalıştırın.

## Execution Protocol Doğrulaması

Mock cloud stage state-machine ve completion-authority regresyon testi external
provider çalıştırmadan Node.js ile koşar:

```bash
corepack pnpm test:protocol
```

Bu test Startup ve Discovery directive zincirlerini simüle eder; tek bir provider
job sonucu PASS olduğunda stage'in erken `completed` olmasını özellikle reddeder.

## Doğrulama

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm format:check
corepack pnpm test
corepack pnpm test:protocol
corepack pnpm build
```

CI aynı temel doğrulama adımlarını Windows, macOS ve Linux üzerinde çalıştırır.
Paketleme ve Electron e2e testleri sonraki fazlarda eklenecektir.
