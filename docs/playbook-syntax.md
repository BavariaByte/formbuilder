# GIRP Playbook Syntax (format v1)

This document specifies the JSON format of GIRP playbooks — the documents the
**Formbuilder** exports and **Backend-SOCView** imports. The machine-readable
counterpart is [`playbook-schema.json`](./playbook-schema.json) (JSON Schema,
draft 2020-12). The authoritative implementation is the import validator in
Backend-SOCView (`lib/playbookValidator.js`); this spec mirrors it.

**Strictness:** unknown keys are rejected at every level. All references
(question ids, variable ids) must resolve. String values are screened against
injection patterns (leading `$`, `__proto__`, `<script`, `javascript:`,
event handlers, `eval(`, …).

## Top level

```json
{
  "type": "form-definition",
  "meta":      { "id": "phishing-triage", "version": "3" },
  "i18n":      { "defaultLocale": "de-DE", "supported": ["de-DE", "en-US"] },
  "form":      { … },
  "runtime":   { … },
  "variables": [ … ],
  "calculation": { … },
  "flow":      { "start": "<uuid>", "end": "submit" },
  "questions": [ … ],
  "schemaId": "",
  "schemaHash": "",
  "_nodePositions": { … }
}
```

| Field | Required | Description |
|---|---|---|
| `type` | yes | Always `"form-definition"` (format discriminator). |
| `meta` | yes | `id` (lowercase letters/digits/hyphens, ≤ 100 chars), `version` (positive integer as string, auto-incremented on export), optional `title`. |
| `i18n` | yes | `defaultLocale` and `supported` locales (`xx-XX`); the default locale must be listed in `supported`. |
| `form` | yes | Presentation: `title`, `description`, `progress.mode` (`step` \| `percent`), `completion.title/description`. |
| `runtime` | no | `session.identityQuestionId` (UUID of the identity question), `session.resume.maxAgeMinutes` (1–525600). |
| `variables` | no | Up to 100 numeric variables: `{ "id": "score", "initial": 0 }`. Ids match `[a-zA-Z_][a-zA-Z0-9_]*`, unique. |
| `calculation` | no | `checkboxOptionOrder` (`definition` \| `alphabetical`), `onDivZero` (`error` \| `skip`), `rounding` (0–10), `effectOrder` (`option-action` \| `action-option`). |
| `flow` | yes | `start` (question UUID, `"submit"`, or `""` for an empty playbook), `end` (always `"submit"`), optional `routingPriority` (`options-first` \| `actions-first`), optional `endBehavior.lockAnswers`. |
| `questions` | yes | Up to 1000 questions (see below). |
| `schemaId` / `schemaHash` | no | Opaque schema identity strings (≤ 200 chars). |
| `_nodePositions` | no | Editor-only node coordinates for graph re-import; not semantically validated. |

## Localized strings

Every user-facing text is either a plain string or a locale-keyed object:

```json
"label": { "de-DE": "Über welchen Weg wurde der Vorfall gemeldet?", "en-US": "How was the incident reported?" }
```

A locale value may reference another locale with `"@link:xx-XX"` ("use that
locale's string"). Length limits: labels/placeholders 1000 chars,
descriptions 50000 chars.

## Questions

Common fields: `id` (UUID, unique, required), `type` (required),
`defaultNext` (required — fallback target: question UUID, `"submit"`, or `""`),
`label`, `description`, `placeholder`, `required`, `validation`, `actions`,
`effects`, `image`, `system.isIdentity`, `options`.

There are **seven question types**:

| Type | Input | Type-specific rules |
|---|---|---|
| `textzeile` | single-line text | `validation`: `minLength`, `maxLength`, `pattern` |
| `textbox` | multi-line text | same as `textzeile` |
| `int` | integer | `validation`: `min`, `max` (numbers) |
| `date` | date | `validation`: `min`, `max` (strings, e.g. `"now"`) |
| `select` | single choice | `options` required (1–200) |
| `checkbox` | multi choice | `options` required; `validation.maxSelections` (≥ 1) |
| `info` | display-only | no input; typically carries `description`/`image`/`effects` |

> The type identifiers `textzeile`/`textbox` are German-derived and kept
> unchanged for schema stability.

### Options (`select` / `checkbox`)

```json
{ "label": { "de-DE": "Persönlich" }, "value": "persoenlich", "next": "<uuid>", "effects": [ … ] }
```

`label` and `value` are required; `value` (≤ 500 chars) must be unique within
the question. `next` overrides navigation when the option is chosen.

### Images

```json
"image": {
  "src": { "de-DE": "data:image/webp;base64,…" },
  "alt": { "de-DE": "Screenshot" },
  "placement": "before", "maxHeight": 400, "fit": "contain"
}
```

`src` is locale-keyed; each value is empty, an `@link:` reference, a base64
`data:image/…` URI (png/jpg/jpeg/gif/webp/svg+xml) or an `assets/<name>.<ext>`
path. Path traversal is rejected.

## Variables and effects

Effects mutate variables and may appear on options, questions and routing
rules (max 20 per list):

```json
{ "var": "impact", "op": "add", "value": 2 }
{ "var": "impact", "op": "add", "value": "$urgency", "lhs": "impact" }
{ "var": "score",  "op": "set", "value": 0, "if": { "var": "reset", "equals": 1 } }
```

- `op`: `add` | `sub` | `mul` | `div` | `set`.
- `value`: numeric literal or a `$variable` reference.
- Standard mode: `var = var op value`. Function mode (with `lhs`):
  `var = lhs op value` — then `value` **must** be a `$` reference.
- Optional `if` condition gates the effect.
- `$variable` (in effect values) and `@link:` (in localized strings) are the
  only reference syntaxes in format v1 — there is no `{{…}}` templating.

## Conditional flow

Per question, navigation resolves in the order given by
`flow.routingPriority`:

1. **`option.next`** — branch attached to the chosen option.
2. **`actions`** — routing rules (max 50): `{ "when": <condition>, "goto": "<uuid|submit>", "effects": [ … ] }`.
   A rule without `goto` is effect-only.
3. **`defaultNext`** — fallback.

The sentinel `"submit"` ends the form.

### Conditions

Combinators (`anyOf`, `allOf`, `not` — nesting depth ≤ 5) over leaf checks.
A leaf targets `var` (variable id) or `questionId` (UUID) and applies one or
more checks: `equals`, `notEmpty`, `isEmpty`, `contains`, `containsAny`,
`containsAll`, `gt`, `gte`, `lt`, `lte`.

```json
{ "allOf": [
    { "var": "impact", "gte": 3 },
    { "not": { "questionId": "<uuid>", "isEmpty": true } }
] }
```

## Limits (enforced on import)

questions ≤ 1000 · options/question ≤ 200 · variables ≤ 100 ·
effects/list ≤ 20 · routing rules/question ≤ 50 · JSON nesting ≤ 15 ·
condition nesting ≤ 5 · generic strings ≤ 10000 chars · image `maxHeight`
≤ 2000 · `rounding` ≤ 10.

## Minimal example

```json
{
  "type": "form-definition",
  "meta": { "id": "neues-playbook", "version": "1" },
  "i18n": { "defaultLocale": "de-DE", "supported": ["de-DE"] },
  "form": {
    "title": { "de-DE": "Neues Playbook" },
    "progress": { "mode": "percent" },
    "completion": {
      "title": { "de-DE": "Vielen Dank" },
      "description": { "de-DE": "Ihre Eingaben wurden gespeichert." }
    }
  },
  "runtime": { "session": { "resume": { "maxAgeMinutes": 120 } } },
  "variables": [ { "id": "score", "initial": 0 } ],
  "calculation": { "checkboxOptionOrder": "definition", "onDivZero": "skip", "rounding": 2, "effectOrder": "action-option" },
  "flow": { "routingPriority": "options-first", "start": "", "end": "submit" },
  "questions": []
}
```
