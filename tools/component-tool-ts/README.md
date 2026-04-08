# component-tool

CLI tool for managing and reviewing conceptual components described by `.component.md` files.

Components are logical groupings of source files with explicit dependency contracts between them. Each dependency is a first-class contract with a stable `contract_id`, mirrored in both the source and target component files. This enables dependency-aware code review: when files change, the tool identifies which components are affected and can invoke an AI agent to verify that each component still meets its description and satisfies its obligations.

## Quick start

```bash
cd tools/component-tool-ts
npm install
npm run build
```

After building, run commands with:

```bash
node dist/cli.js <command> [options]
```

Or link it globally:

```bash
npm link
component-tool <command> [options]
```

## File format

Each component is described by a `.component.md` file with YAML frontmatter as the canonical structured data, and generated markdown sections for human readability:

```md
---
schema_version: 1
component_id: payments.invoice_renderer
title: Invoice Renderer
scope:
  include:
    - "services/payments/invoices/**"
  exclude:
    - "**/*_test.py"
dependencies:
  - contract_id: dep.template_vars
    target_component_id: shared.templates
    target_path: ./shared/templates.component.md
    expectation: Shared templates provide stable invoice variables.
dependants:
  - contract_id: dep.render_pdf
    source_component_id: billing.api
    source_path: ./billing-api.component.md
    expectation: This component renders invoice PDFs within the request timeout budget.
---

# Invoice Renderer

## Description
Freeform human-written description of the component.

## Scope
<!-- component-tool:generated:start -->
- include: `services/payments/invoices/**`
- exclude: `**/*_test.py`
<!-- component-tool:generated:end -->

## Dependencies
<!-- component-tool:generated:start -->
- `dep.template_vars` [shared.templates](./shared/templates.component.md) — Shared templates provide stable invoice variables.
<!-- component-tool:generated:end -->

## Dependants
<!-- component-tool:generated:start -->
- `dep.render_pdf` [billing.api](./billing-api.component.md) — This component renders invoice PDFs within the request timeout budget.
<!-- component-tool:generated:end -->
```

Key design decisions:

- **YAML frontmatter** is the source of truth for structured data.
- **`Description`** is freeform human-authored markdown, preserved across edits.
- **`Scope`**, **`Dependencies`**, and **`Dependants`** sections are generated from frontmatter and delimited by `<!-- component-tool:generated -->` markers.
- Every dependency contract is **mirrored**: it appears as a `dependency` in the source component and as a `dependant` in the target component, with matching `contract_id` and `expectation` text.

## Commands

### `list-all`

List all components with their dependency counts.

```bash
component-tool list-all -w <workspace>
component-tool list-all -w <workspace> --json
```

### `list-deps <component> [target]`

Show outgoing dependency contracts for a component. Optionally filter by target.

```bash
component-tool list-deps payments.invoices -w <workspace>
component-tool list-deps payments.invoices shared.templates -w <workspace>
component-tool list-deps payments.invoices -w <workspace> --json
```

### `add-comp <file-path>`

Create a new `.component.md` file from a template.

```bash
component-tool add-comp components/my-service.component.md \
  --id my.service \
  --title "My Service" \
  --scope "src/my-service/**" \
  --scope-exclude "**/*_test.ts" \
  --description "Handles service logic." \
  -w <workspace>
```

Use `--force` to overwrite an existing file.

### `add-dep <source> <target> <expectation>`

Add a dependency contract between two components. Updates both files with mirrored entries.

```bash
component-tool add-dep my.service shared.utils \
  "Shared utils provide date formatting helpers." \
  -w <workspace>
```

A `contract_id` is auto-generated unless `--contract-id <id>` is provided.

### `validate`

Check all component files for structural invariants.

```bash
component-tool validate -w <workspace>
component-tool validate -w <workspace> --json
```

Hard errors (exit code 1):
- Duplicate `component_id` or `contract_id`
- Broken component link (target does not exist)
- Link resolving outside the workspace root
- Missing mirrored contract on the other side
- Mirrored contract expectation text mismatch
- Mirrored contract pointing to wrong opposite component

Warnings (exit code 0):
- Component scope resolves to zero files
- Unreferenced component (no deps or dependants)
- Cyclic dependency graph

### `review <component>...`

Review one or more components using an AI agent.

```bash
component-tool review payments.invoices shared.templates \
  -w <workspace> \
  --agent claude \
  --model sonnet \
  --timeout 300 \
  -o .component-tool/reviews
```

The reviewer:
1. Inspects all files in the component's scope
2. Assumes outgoing dependency contracts are true
3. Verifies the component satisfies all incoming obligations from dependants
4. Reports numbered issues and proposes missing invariants

Reports are written per-component as JSON, Markdown, and raw agent output under `.component-tool/reviews/<run-id>/`.

### `review-all`

Review every component. Requires `--yes` (or `-y`) to confirm in non-interactive mode.

```bash
component-tool review-all -w <workspace> --yes --agent claude
```

### `review-diff`

Review only the components affected by current git changes (staged, unstaged, and untracked non-ignored files).

```bash
component-tool review-diff -w <workspace> --agent claude
```

A component is "affected" if:
- Its `.component.md` file was changed, or
- Any file matching its scope patterns was changed

Files changed but owned by no component produce a warning.

## Architecture

```
src/
  models.ts          Zod schemas and TypeScript interfaces (Component, DependencyContract, ComponentGraph, ReviewResult, etc.)
  scanner.ts         Git-aware .component.md file discovery, path resolution with escape protection
  parser.ts          YAML frontmatter parsing, round-trip rendering, generated section markers
  graph.ts           Builds ComponentGraph with scope index, reverse indexes, contract resolution
  validator.ts       Structural invariant checking (8 error rules, 3 warning rules)
  editor.ts          File creation (add-comp) and mirrored contract insertion (add-dep)
  agentAdapter.ts    AgentAdapter interface with ClaudeAdapter, CodexAdapter, FakeAdapter
  reviewEngine.ts    Prompt builder, ReviewScheduler with fingerprint dedup, review-diff git integration
  reportWriter.ts    Per-component JSON + MD + raw.txt reports, summary files
  utils.ts           Glob matching, git file listing helpers
  cli.ts             Commander CLI with all 8 commands
```

The internal model is graph-centered. `ComponentGraph` holds:
- `components` map (component_id -> Component)
- `contracts` map (contract_id -> DependencyContract)
- `dependencies_of` / `dependants_of` reverse indexes
- `file_to_components` scope index for review-diff

The `ReviewScheduler` supports fingerprint-based deduplication so that future interactive/parallel review can safely re-review components only when their inputs changed.

## Agent adapters

The review engine delegates AI invocation to an `AgentAdapter` interface:

- **ClaudeAdapter** runs `claude -p <prompt> --output-format text --model <model>`
- **CodexAdapter** runs `codex --prompt <prompt>`
- **FakeAdapter** returns deterministic responses for testing

Add new adapters by implementing `runReview(prompt, cwd, timeoutSec)`.

## Testing

```bash
npm test           # run all tests (vitest)
npm run test:watch # watch mode
```

74 tests covering:
- Parser round-trips and frontmatter extraction
- Scanner gitignore handling and symlink escape protection
- Graph building, scope resolution, and index construction
- Validator error/warning detection for all invariant rules
- Editor mirrored contract creation and description preservation
- Review prompt generation and FakeAdapter integration
- Scheduler fingerprint deduplication
- Git change detection and affected component resolution
- Report file generation

## Python version

A Python implementation with identical functionality is available at `tools/component-tool/`. Install with:

```bash
cd tools/component-tool
pip install -e .
component-tool <command> [options]
```

Run Python tests with:

```bash
cd tools/component-tool
python3 -m pytest tests/ -v
```
