# web-v2/usage Specification

## Purpose
The V2 Usage screen: what the workspace spent — tokens, cost, runs and their breakdowns — over a chosen
window and grain, in V2's Mono language. It is the kept V1 Usage screen restyled, with the same windows,
grain, figures and breakdowns.

## Requirements

### Requirement: A window and grain select what the page reports

The screen SHALL offer the same usage windows V1 does (including a custom range) and the same grain
(day and week), and changing either SHALL re-read every figure on the page for that window and grain.
The chosen window and grain SHALL be shown by the control in the header.

#### Scenario: Changing the window

- **WHEN** the human chooses a different window
- **THEN** the headline figures and every breakdown re-read for that window

#### Scenario: Changing the grain

- **WHEN** the human chooses a different grain
- **THEN** the per-bucket series and the per-project bars re-bucket at that grain

#### Scenario: A custom range

- **WHEN** the human chooses the custom window and picks a start and end
- **THEN** every figure reports that range

### Requirement: The headline figures and plan limits are shown

The screen SHALL show the window's total tokens as the headline, cost as a secondary figure only when
some of the window was billed per token, the run count and the cached-input share, each from the same
usage response the breakdowns use. It SHALL show the account plan limits with their reset, or the quiet
absent state when there is no account snapshot, and the runtime credentials above the usage figures so a
stopped runtime is explained.

#### Scenario: Tokens are the headline

- **WHEN** the window has usage
- **THEN** total tokens, runs and cached-input share are shown, and cost is shown only when some usage
  was billed per token

#### Scenario: A subscription window shows no cost

- **WHEN** the window's usage was entirely subscription-included
- **THEN** the cost figure is omitted rather than shown as zero

#### Scenario: No account snapshot

- **WHEN** there is no account snapshot to read limits from
- **THEN** the plan-limits area shows its quiet absent state, not a zeroed bar

#### Scenario: An expired runtime credential

- **WHEN** a runtime's credential is expired or missing
- **THEN** it is reported above the usage figures

#### Scenario: No usage in the window

- **WHEN** the window has no usage at all
- **THEN** the screen shows an empty state inviting a wider window, rather than empty charts

### Requirement: The breakdowns are kept

The screen SHALL show the same breakdowns as V1: tokens per bucket by project as stacked bars; top
tickets by cost or tokens as a subtree rollup; usage by role and by worker; runs per bucket as a series;
the model mix with each model's tokens and, when cost applies, cost; and the project share. Each
breakdown SHALL derive from the same scoped query the headline uses.

#### Scenario: The breakdowns render

- **WHEN** the window has usage
- **THEN** the by-project bars, top tickets, by-role, by-worker, runs series, model mix and project
  share all render from that window's data

#### Scenario: Cost-labelled breakdowns

- **WHEN** some of the window was billed per token
- **THEN** the ranked breakdowns label their right-hand figure as cost, and otherwise as tokens

### Requirement: A model filters the whole page

The model mix SHALL let the human choose a model, and choosing one SHALL filter every figure and
breakdown on the page to that model, with a visible way to clear the filter.

#### Scenario: Filtering to a model

- **WHEN** the human chooses a model in the model mix
- **THEN** every figure and breakdown reports only that model, and the active filter is named

#### Scenario: Clearing the filter

- **WHEN** the human clears the model filter
- **THEN** every figure reports the whole scope again

### Requirement: Knowledge context is shown

The screen SHALL show the knowledge context section V1 shows — the average knowledge tokens a run
consumed, the documents never read, and the documents read most often with their read counts — scoped to
the same window, and separate from the billed model-token figures above it.

#### Scenario: Knowledge context renders

- **WHEN** the window has knowledge reads
- **THEN** the average knowledge tokens per run, the never-read documents and the most-read documents
  are shown, labelled as distinct from the billed token figures
