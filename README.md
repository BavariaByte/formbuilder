# GIRP — Formbuilder

Visual low-code editor for designing GIRP incident response playbooks. Admins use this tool to compose form flows that are subsequently published and processed by the intake pipeline.

Built with **Vue 3**, **TypeScript**, and **Rete.js v2**.

A hosted version of the editor is available at
**https://builder.girp.bavariabyte.com** — no installation required.

Part of the **GIRP (Guided Incident Response Platform)** — see the other
repositories: Frontend-Inputform, Frontend-SOCView, Backend-Inputform and
Backend-SOCView.

## Technology Stack

- **Framework**: Vue 3 (Composition API, `<script setup>`)
- **Language**: TypeScript
- **Build Tool**: Vite
- **State Management**: Pinia
- **Graph Engine**: Rete.js v2 with ELK auto-layout
- **Styling**: Vanilla CSS with CSS custom properties

## Prerequisites

- **Node.js** >= 22.16 and **npm**
- Optionally **Docker** (for the containerized nginx deployment via
  `docker-compose.yml`)

## Setup

```bash
npm install
npm run dev      # development server at http://localhost:8080
npm run build    # production build
npm run preview  # preview production build
```

## Development

```bash
npm run type-check   # vue-tsc
npm run lint         # ESLint
npm test             # Vitest unit tests
```

## Architecture

The editor is structured around three layers:

**Store layer** (`src/store/`): Pinia stores manage the canonical graph state (`graph.ts`), editor UI state (`editor.ts`), and validation results (`validation.ts`). All node and edge mutations go through the store — the Rete.js canvas is a rendering concern only.

**Engine layer** (`src/engine/`): Stateless modules for import (`importer.ts`), export (`exporter.ts`), layout (`layout.ts`), and validation (`validator.ts`). Import and export handle the full JSON playbook schema including global config, i18n, variables, and node positions.

**Rete layer** (`src/rete/`): Wires up the Rete.js editor instance, registers node types, sockets, and connection rules.

## Key Components

| Component | Purpose |
|---|---|
| `EditorCanvas.vue` | Main canvas; synchronises Rete.js node graph with the Pinia store |
| `Inspector.vue` | Context-aware side panel for editing the selected node's properties |
| `GlobalPanels.vue` | Modal panels for playbook-level configuration (meta, i18n, form config, variables, calculations) |
| `ProblemsPanel.vue` | Displays validation errors and warnings with navigation to affected nodes |
| `ImportModal.vue` | JSON file or paste import with validation and warning reporting |
| `ExportModal.vue` | JSON export with schema validation before download |

## Node Types

| Type | Description |
|---|---|
| `start` | Entry point of the form flow (exactly one per playbook) |
| `end` | Terminal node; triggers form submission |
| `question` | A single form question with type, label, options, validation, and conditional routing |

## Playbook Format

Playbooks are exported as JSON documents. The format is documented in this
repository:

- [`docs/playbook-schema.json`](docs/playbook-schema.json) — machine-readable
  JSON Schema for validating playbooks
- [`docs/playbook-syntax.md`](docs/playbook-syntax.md) — human-readable syntax
  reference (question types, variables, calculations, conditional flow, i18n)

## Template Playbooks

`template_playbooks/` contains the templates offered in the new-playbook
dialog, including a complete demo playbook for the **fictional** company
"Kronberg GmbH" — all names, domains and infrastructure details in the demo
are invented. See `template_playbooks/README.md` for how to add templates.

## Trademarks

The GIRP and BavariaByte names and logos (`src/assets/logo-*.png`,
`public/favicon.*`) are trademarks of BavariaByte and are not covered by the
code license. Forks must replace them with their own branding.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Pull
requests target the `develop` branch (GitFlow).

## Security

See [SECURITY.md](SECURITY.md) for how to report vulnerabilities.

## License

GIRP is **source-available** under the
[Sustainable Use License](LICENSE.md).
