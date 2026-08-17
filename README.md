# ForgePilot

ForgePilot is an open-source desktop client for AI Factory.

It provides a local interface for running and managing AI-assisted software engineering workflows through installed coding agents such as Claude Code and Codex.

The desktop application is open source so users can inspect exactly what the client does on their machine.

ForgePilot does not contain the proprietary AI Factory rules, agents, workflows, or orchestration intelligence. Those remain on the AI Factory server and are delivered only as required for execution.

## Why ForgePilot Exists

AI coding tools are powerful, but using them directly often means:

* working from the terminal,
* manually managing prompts,
* manually switching between agents,
* tracking workflow state yourself,
* interpreting raw output,
* and maintaining your own validation process.

ForgePilot provides a controlled desktop layer around those tools.

The user selects a project, chooses an available AI provider, and starts an AI Factory workflow from the desktop application.

ForgePilot handles the local execution and presents the results through a structured interface.

## Architecture

```text
┌──────────────────────────────┐
│         ForgePilot           │
│      Open Source Client      │
│                              │
│  • Desktop UI                │
│  • Project Management        │
│  • Provider Detection        │
│  • Process Management        │
│  • Local Validation          │
│  • Logs                      │
│  • Results / Findings        │
└──────────────┬───────────────┘
               │
               │ HTTPS
               ▼
┌──────────────────────────────┐
│       AI Factory Cloud       │
│                              │
│  • Agents                    │
│  • Rules                     │
│  • Skills                    │
│  • Workflows                 │
│  • Policies                  │
│  • Prompt Construction       │
│  • Orchestration Logic       │
└──────────────┬───────────────┘
               │
               ▼
      Local Coding Provider

      Claude Code
          or
        Codex
```

## Open Source vs. Server-Side Components

ForgePilot intentionally separates the desktop client from the proprietary AI Factory intelligence.

### Open Source

The ForgePilot repository may include:

* Electron application
* desktop interface
* Node.js services
* TypeScript source code
* project management
* provider adapters
* Claude Code integration
* Codex integration
* process execution
* IPC implementation
* local validators
* local caching
* logging
* update mechanisms
* API client
* security controls
* result rendering

This allows anyone to inspect what ForgePilot executes locally.

### Not Included in This Repository

The following AI Factory components remain server-side:

* proprietary agent definitions
* proprietary rules
* private skills
* workflow intelligence
* internal system prompts
* orchestration policies
* evaluation methodologies
* scoring systems
* internal decision logic
* private validation strategies

These components are not bundled inside the ForgePilot executable.

## Transparency

One of ForgePilot's primary design goals is transparency.

Because the desktop client runs on the user's machine and may interact with local source code, the client itself is open source.

Users and organizations can review the source code to understand:

* which files ForgePilot accesses,
* which commands it executes,
* which local processes it starts,
* which network requests it makes,
* what information is sent to AI Factory Cloud,
* how Claude Code or Codex is invoked,
* and how credentials are handled.

ForgePilot should never require users to blindly trust an opaque executable.

## How It Works

A typical execution looks like this:

```text
1. User opens ForgePilot

2. User selects a local project

3. ForgePilot checks installed providers

   Claude Code  ✓
   Codex        ✓

4. User selects a provider

5. ForgePilot contacts AI Factory Cloud

6. AI Factory creates the required job

7. ForgePilot executes the job locally
   through the selected provider

8. Output is collected and validated

9. Results are displayed in ForgePilot

10. Findings and execution state are
    synchronized with AI Factory
```

## Provider Model

ForgePilot does not provide its own foundation model.

Instead, it uses compatible coding agents installed on the user's computer.

Initially supported providers are expected to include:

* Claude Code
* OpenAI Codex

The architecture is provider-independent.

Future providers can be implemented through additional adapters.

Conceptually:

```text
ProviderAdapter

├── isInstalled()
├── getVersion()
├── getStatus()
├── createExecutionCommand()
└── dispose()
```

This keeps the core ForgePilot application independent from a specific AI provider.

Sağlayıcıya özgü CLI komutu, argümanlar ve stdin sözleşmesi adaptörde kalır; ortak process yaşam döngüsü ve çıktı akışı execution service tarafından yönetilir.

## Your AI Account

ForgePilot is designed to use the user's own installed provider and account where supported.

For example, if a user runs Claude Code through ForgePilot, Claude Code continues to operate through the user's own environment and authentication.

ForgePilot does not need to distribute a shared Claude or Codex API key inside the desktop application.

## Server-Driven Workflows

ForgePilot is designed as a thin execution client.

Workflow logic should not be hard-coded into the application.

Stage çalıştırılırken desktop, AI Factory Cloud'dan tüm planı değil yalnızca **sıradaki execution directive** bilgisini alır. Directive; isimlendirilmiş deterministic local operation, tek bir provider job veya terminal stage sonucu olabilir. Böylece proprietary workflow planı desktop içine gömülmez veya topluca indirilmez.

For example, stages such as:

```text
Discovery
Context
Analysis
Architecture
Database
API
Implementation
Validation
```

may be defined by AI Factory Cloud.

This allows AI Factory workflows to evolve without requiring a new ForgePilot release every time a rule, agent, or workflow changes.

A server-side rule update should normally require:

```text
AI Factory Cloud update
```

not:

```text
ForgePilot.exe rebuild
```

## Security Model

ForgePilot should follow standard Electron security practices.

Important principles include:

* `contextIsolation` enabled
* Node integration disabled in renderer processes
* controlled preload APIs
* strict IPC validation
* minimal filesystem permissions
* explicit project directory boundaries
* no plaintext API credentials
* sensitive log redaction
* HTTPS-only communication with AI Factory
* secure OS credential storage where appropriate

Renderer processes should never receive unrestricted access to Node.js, the operating system, or `child_process`.

## Privacy

ForgePilot may need to inspect local project information in order to perform AI Factory workflows.

The application should make data boundaries explicit.

Users should be able to understand what data is processed locally and what data is transmitted externally.

ForgePilot should avoid collecting unrelated files or information outside the selected project.

Sensitive values such as:

* passwords
* API keys
* authorization tokens
* access credentials

should never be intentionally written to application logs.

## Language Packs

ForgePilot is designed to support multiple interface languages.

The default language is `en-US` and is bundled with the application so ForgePilot
can run without installing any language pack.

Additional languages are loaded through external JSON-based language packs rather
than being embedded directly into the executable.

Language packs are data-only packages. They must not contain executable code,
scripts, HTML, or commands. Production builds should only activate verified and
signed language packs.

## No Hidden AI Factory Repository

ForgePilot must not silently download a complete copy of AI Factory's private rule, agent, skill, or workflow repository.

AI Factory Cloud should provide task-specific execution information only when required.

For example, the architecture should favor:

```text
Request Job
     ↓
Receive Task
     ↓
Execute Task
     ↓
Return Result
```

rather than:

```text
Download entire AI Factory knowledge base
```

## Development Stack

The initial desktop implementation is expected to use:

```text
Electron
Node.js
TypeScript
React
Vite
SQLite
Zod
```

This may evolve over time.

## Repository Structure

A possible high-level structure:

```text
src/

├── main/
│   ├── app/
│   ├── ipc/
│   ├── providers/
│   ├── process/
│   ├── filesystem/
│   ├── security/
│   └── updates/
│
├── renderer/
│   ├── pages/
│   ├── components/
│   ├── features/
│   └── stores/
│
├── shared/
│   ├── types/
│   ├── schemas/
│   └── constants/
│
└── services/
    ├── api/
    ├── jobs/
    ├── projects/
    └── runs/
```

## Development Status

ForgePilot is currently under active development.

APIs, architecture, provider integrations, and UI behavior may change before a stable release.

Do not rely on internal interfaces remaining backward compatible during early development.

## Contributing

Contributions to the open-source desktop client are welcome.

Useful contribution areas may include:

* bug fixes
* security improvements
* UI improvements
* accessibility
* performance
* provider adapters
* process management
* testing
* documentation
* platform compatibility

Changes involving AI Factory's private server-side intelligence are outside the scope of this repository.

## Security Reports

If you discover a security issue, avoid publishing sensitive exploitation details in a public GitHub issue.

A private security reporting channel should be used once one is published for the project.

## Licensing

The ForgePilot desktop client will be distributed under the license specified in this repository.

Important:

The open-source license covering ForgePilot does **not automatically grant rights to AI Factory's proprietary cloud services, private workflows, agents, rules, prompts, or other server-side intellectual property.**

ForgePilot and AI Factory Cloud should be treated as separate components with separate licensing terms where applicable.

## Project Philosophy

ForgePilot follows a simple principle:

> **The client should be inspectable. The intelligence does not need to be downloadable.**

Users should be able to verify what software is running on their computer without requiring AI Factory to distribute its complete proprietary system.

---

**ForgePilot**
Open-source desktop execution client for AI Factory.

## Discovery stage catalog

ForgePilot, `020-Discovery` stage listesini ve HARD/SOFT gereksinimlerini proje içindeki `.ai-factory/020-Discovery/STAGE-EXECUTION-MANIFEST.json` dosyasından okur. Tüm substages görünür; hazır olmayanlar `Not Ready`, eksik HARD gereksinimi olanlar `Run requirement`, çalıştırılabilir olanlar `Start stage` olarak sunulur. Ayrıntı: `docs/DISCOVERY-STAGE-EXECUTION.md`.
