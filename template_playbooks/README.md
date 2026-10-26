# Template Playbooks

This directory contains the playbook templates offered in the Formbuilder's new-playbook dialog.

## Adding Templates

Templates are standard JSON files placed directly in this directory. The Formbuilder reads them at startup — no rebuild is required. Files are listed alphabetically; numeric prefixes (`01-`, `02-`, ...) can be used to control display order.

Each file must be a valid GIRP playbook and must include `name` and `desc` as top-level fields:

```json
{
  "name": "Display name in the dialog",
  "desc": "Short description of the template.",
  "type": "form-definition",
  ...
}
```

The `name` and `desc` fields are stripped automatically on import and do not appear in the resulting playbook.

## Hosting

In production, this directory is served by nginx with `autoindex` enabled. All filenames are publicly visible via directory listing. No non-public content must be placed here.
