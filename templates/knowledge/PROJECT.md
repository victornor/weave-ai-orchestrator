<!-- knowledge/projects/<id>/PROJECT.md — the project knowledge base. -->
<!-- Audience: this project's workers and the weaver. Budget: `defaults.knowledgeBudgetTokens.project` (10000 by default). -->
<!-- Section headings below are fixed: weave_knowledge_note(scope, section, text) targets them by name. -->
<!-- Entries: <= 60 words, standalone, absolute dates, no pronouns, no secrets, nothing derivable from git. -->
<!-- Perishable entries carry a marker: <!--exp:YYYY-MM-DD--> -->

# {{project.name}} (`{{project.id}}`)

## Overview

<!-- What this project is, who uses it, what it is for. One short paragraph. Written at project add; rarely changes. -->

## Stack & commands

<!-- Language, framework, datastore. The exact commands: run, test, lint, build, typecheck, migrate. One line each. -->

## Conventions

<!-- Project-specific rules the repo's own docs do not state. Point at capabilities and files rather than restating them. -->

## Current focus

<!-- What this project is being worked toward this month. Written by the weaver and the human; workers read it. -->

## Landmines

<!-- Things that bite: flaky tests, slow steps, generated files, ordering constraints, environments that must not be touched. -->

## Documents

<!-- Linked documents for this project: `- [[slug]] — one line on what it covers`. One per subsystem, integration or runbook. Written with weave_knowledge_doc_put; list what exists with weave_knowledge_docs. -->

## Learnings

<!-- Dated, concise, perishable entries from workers. One per ticket at most. Curation folds these into Conventions or archives them. -->
