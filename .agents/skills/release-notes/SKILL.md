---
name: generate-release-notes
description: Generate bilingual user-facing release notes and changelog from Git history
---

# /generate-release-notes — Bilingual release notes for browser extension

You are a product release editor for a browser extension.

Your task is to analyze Git changes for a selected period or version range and generate **simple, human-readable release notes and changelog** for ordinary users.

The final release notes must be written in **two languages**:

1. Russian
2. English

The Russian version must come first.

The output must explain what changed in the extension without exposing unnecessary technical details.

---

## Product context

This repository contains a browser extension for AV.by.

The extension helps users see car prices on AV.by in a convenient currency instead of only BYN.

Known product behavior:

- converts prices from BYN to USD, EUR, or RUB
- can return prices back to BYN
- works on AV.by pages with listings, car cards, similar listings, dealer blocks, and monthly payment text
- has a popup with exchange rates and a simple currency converter
- saves the selected currency locally in the browser
- updates exchange rates automatically
- uses cached rates when the external exchange-rate API is temporarily unavailable
- supports Firefox and Chrome-based browsers

Use this context only as product background.

Do not claim a specific change happened unless Git history confirms it.

---

## Invocation

```bash
/generate-release-notes [--from <ref|date>] [--to <ref|date>] [--version <version>] [--output <path>]
```

### Examples

```bash
/generate-release-notes --from v1.0.0 --to v1.1.0
/generate-release-notes --from 2026-04-01 --to 2026-05-01
/generate-release-notes --version 1.2.0
```

---

## Output target

Default output path:

```text
release-notes/<version-or-date-range>.md
```

If `--output` is provided, write to that exact path.

If no version is provided, infer a safe filename from the compared refs or dates.

Examples:

```text
release-notes/v1.1.0.md
release-notes/2026-04-01-2026-05-01.md
release-notes/main-since-v1.0.0.md
```

---

## Source of truth

Use Git history as the source of truth.

Analyze:

- commit messages
- commit bodies
- changed files
- diffs for unclear commits
- package/version files if relevant
- manifest version if relevant
- README only as product context, not proof of a release change

Do not invent release content.

---

## Non-negotiable constraints

### 1. Bilingual output

The final release notes must contain both language versions:

1. Russian version first
2. English version second

Both versions must describe the same release and the same verified changes.

The English version must not add facts that are absent from the Russian version.

The Russian version must not add facts that are absent from the English version.

The two versions do not need to be literal word-for-word translations, but they must be semantically equivalent.

### 2. User-facing language

Write for ordinary extension users.

The reader may not know what a content script, service worker, storage API, Manifest V3, DOM, selector, or build script is.

Explain changes through visible effect.

Bad:

- `Refactored content script selector handling.`
- `Updated service worker alarm logic.`
- `Added browser/chrome shim.`
- `Changed MutationObserver behavior.`

Good in Russian:

- `Расширение стало надежнее находить цены на странице AV.by.`
- `Курсы стали обновляться стабильнее.`
- `Одна и та же версия расширения лучше работает в Firefox и Chrome-based браузерах.`
- `Цены должны обновляться даже на страницах, где объявления подгружаются постепенно.`

Good in English:

- `The extension should now detect more prices on AV.by pages more reliably.`
- `Exchange rates should update more consistently.`
- `The same extension version works better across Firefox and Chromium-based browsers.`
- `Prices should keep updating even when AV.by loads listings dynamically.`

### 3. No hallucinations

Only describe changes supported by Git evidence.

Do not invent:

- performance improvements
- browser support
- store publication status
- privacy claims
- bug impact
- exact percentages
- “fully fixed”
- “completely rewritten”
- “much faster”
- “стало в X раз быстрее”
- “полностью исправлено”
- “ускорено”

unless directly supported by commits or diffs.

Use cautious wording when appropriate.

Russian examples:

- `должно работать стабильнее`
- `стало меньше риска`
- `расширение аккуратнее обрабатывает`
- `улучшили поведение`
- `подготовили основу`

English examples:

- `should work more reliably`
- `reduces the risk`
- `handles this case more carefully`
- `improves behavior`
- `prepares the foundation`

### 4. No raw technical changelog

Do not dump commits.

Do not copy commit messages verbatim.

Merge related commits into one readable item.

Describe outcomes, not implementation steps.

### 5. Filter noise

Ignore low-signal commits unless they affect users or release quality:

- merge commits
- formatting-only changes
- typo-only changes
- lockfile-only changes
- version bumps without other changes
- internal cleanup with no visible effect
- test-only changes without behavioral impact
- build-script changes that do not affect install/use/release

### 6. Keep technical details secondary

A small technical section is allowed, but it must be short and understandable.

The main release notes must be non-technical.

### 7. Empty sections

Do not keep empty sections.

If a category has no meaningful changes, omit it from both language versions.

---

## Git evidence collection

Execute silently.

Use the best available comparison depending on invocation.

### If `--from` and `--to` are refs

Use:

```bash
git log --no-merges --date=short --pretty=format:"%H%x09%ad%x09%s%x09%b" <from>..<to>
git diff --stat <from>..<to>
```

For unclear changes:

```bash
git diff <from>..<to> -- <path>
```

### If `--from` and `--to` are dates

Use inclusive date boundaries:

```bash
git log --since="<from> 00:00:00" --until="<to> 23:59:59" --no-merges --date=short --pretty=format:"%H%x09%ad%x09%s%x09%b"
git log --since="<from> 00:00:00" --until="<to> 23:59:59" --no-merges --stat
```

### If `--version` is provided

Inspect files that may contain version data, such as:

- `manifest.json`
- `package.json`
- release files
- tags
- changelog/release-notes directory, if present

Do not assume release version unless observable.

---

## Change classification

Group meaningful changes by user value.

Possible categories:

### Visible improvements

Use for changes users can notice directly:

- price conversion behavior
- popup interface
- currency selection
- converter behavior
- displayed exchange rates
- AV.by page coverage
- support for more price blocks
- original BYN price restoration
- behavior on dynamic pages

### Reliability and correctness

Use for changes that make the extension safer or more dependable:

- rate update fallback
- cached rates
- error handling
- avoiding broken conversions
- preventing duplicate price replacements
- restoring original prices
- browser compatibility
- stable behavior after page changes

### Browser and installation

Use for:

- Firefox support
- Chrome-based support
- manifest changes
- build/package changes
- installation instructions
- release packaging

### Privacy and local data

Use only when supported by changes:

- local storage behavior
- no user data collection
- permissions clarity
- API usage clarity

### Fixes

Use only for user-relevant bugs:

- wrong conversion
- missing prices
- duplicate values
- stale rates
- popup not updating
- broken browser behavior
- original BYN prices not restoring
- page content changing after load

### Technical notes

Use sparingly for internal work that matters to release quality.

Explain practical effect in plain language.

---

## Main story selection

Pick one main release theme.

Prioritize:

1. most visible user improvement
2. correctness or reliability fix
3. browser compatibility
4. release/install improvement
5. internal architecture only if it materially affects users

Good Russian release themes:

- `Цены стали понятнее`
- `Надежнее на AV.by`
- `Лучше работает с курсами`
- `Удобнее выбор валюты`
- `Firefox и Chrome`

Good English release themes:

- `Clearer Prices`
- `More Reliable on AV.by`
- `Better Exchange Rates`
- `Easier Currency Choice`
- `Firefox and Chrome`

Avoid generic themes:

- `Обновление расширения`
- `Новая версия`
- `Исправления и улучшения`
- `Рефакторинг`
- `Extension Update`
- `New Version`
- `Fixes and Improvements`
- `Refactoring`

---

## Writing style

Write Russian and English versions in a simple, natural, user-facing style.

Tone:

- simple
- clear
- calm
- practical
- human
- not technical
- not marketing-heavy

### Russian style

Avoid:

- `реализована возможность`
- `внедрена поддержка`
- `произведен рефакторинг`
- `оптимизирован механизм`
- `улучшена архитектура`
- `в рамках релиза`
- `проведена работа`
- `пользовательский опыт был улучшен`

Prefer:

- `Добавили`
- `Исправили`
- `Обновили`
- `Упростили`
- `Теперь`
- `Расширение стало`
- `Цены теперь`
- `Курсы теперь`
- `Попап теперь`
- `Стало проще`
- `Меньше риска`

### English style

Avoid:

- `implemented functionality`
- `introduced support`
- `performed refactoring`
- `optimized the mechanism`
- `improved architecture`
- `as part of this release`
- `work was carried out`
- `user experience was improved`

Prefer:

- `Added`
- `Fixed`
- `Updated`
- `Simplified`
- `Now`
- `The extension now`
- `Prices now`
- `Rates now`
- `The popup now`
- `It is easier to`
- `There is less risk of`

---

## Required output structure

Use this template.

Omit empty sections.

```md
---

version: <version or unknown>
date_from: <YYYY-MM-DD or ref>
date_to: <YYYY-MM-DD or ref>
tags: release-notes
release_title_ru: "<2–5 слов>"
release_title_en: "<2–5 words>"

---

# <release_title_ru>

## Коротко

[2–4 предложения: главное изменение версии простыми словами. Что стало лучше для пользователя и почему это важно.]

---

## Что изменилось

### Для пользователей AV.by

* **[Короткое название]:** [Что изменилось в работе расширения.] [Почему это удобно.]
* **[Короткое название]:** [Что стало понятнее, надежнее или быстрее для пользователя.]

### Курсы и валюты

* **[Короткое название]:** [Что изменилось в выборе валюты, курсах, обновлении или конвертере.]
* **[Короткое название]:** [Как это помогает видеть цены корректнее.]

### Работа в браузере

* **[Короткое название]:** [Что изменилось для Firefox, Chrome-based браузеров, установки или обновления.]
* **[Короткое название]:** [Что стало стабильнее или проще.]

---

## Исправили

* Исправили ситуацию, когда [что было не так] — теперь [как стало].
* Убрали проблему с [ценами / курсами / попапом / страницами AV.by] — [почему это важно].
* Починили [поведение] — [какой пользовательский эффект].

---

## Технически

[Короткий блок для тех, кому интересно. 1–4 пункта максимум. Не использовать как основной changelog.]

* [Внутреннее изменение простыми словами.] [Какой практический эффект оно дает.]
* [Изменение в сборке, тестах или совместимости, если оно важно для релиза.]

---

## Что это значит для пользователя

[1–3 предложения: как обновление влияет на обычное использование расширения.]

---

## Полный список изменений

[Короткий человекочитаемый changelog. Не raw commits.]

* [Изменение 1]
* [Изменение 2]
* [Изменение 3]

---

# <release_title_en>

## Summary

[2–4 sentences: the main release change in plain language. What improved for the user and why it matters.]

---

## What changed

### For AV.by users

* **[Short label]:** [What changed in the extension.] [Why it is useful.]
* **[Short label]:** [What became clearer, safer, or more reliable.]

### Rates and currencies

* **[Short label]:** [What changed in currency selection, exchange rates, updates, or converter behavior.]
* **[Short label]:** [How this helps users see prices more accurately.]

### Browser experience

* **[Short label]:** [What changed for Firefox, Chromium-based browsers, installation, or updates.]
* **[Short label]:** [What became more stable or easier.]

---

## Fixed

* Fixed a case where [what was wrong] — now [what changed].
* Removed an issue with [prices / rates / popup / AV.by pages] — [why it matters].
* Fixed [behavior] — [user-facing effect].

---

## Technical notes

[A short section for readers who want a little more detail. 1–4 bullets maximum. Do not use it as the main changelog.]

* [Internal change in plain language.] [Practical effect.]
* [Build, test, or compatibility change if important for the release.]

---

## What this means for users

[1–3 sentences: how this update affects everyday use of the extension.]

---

## Full changelog

[A short human-readable changelog. Not raw commits.]

* [Change 1]
* [Change 2]
* [Change 3]
```

---

## Section rules

### Frontmatter

Use:

```yaml
---

version: <version or unknown>
date_from: <YYYY-MM-DD or ref>
date_to: <YYYY-MM-DD or ref>
tags: release-notes
release_title_ru: "<2–5 слов>"
release_title_en: "<2–5 words>"

---
```

Rules:

- `release_title_ru` must be 2–5 Russian words
- `release_title_en` must be 2–5 English words
- Russian main heading must equal `release_title_ru`
- English main heading must equal `release_title_en`
- `tags` must be exactly `release-notes`
- if version is unknown, use `unknown`
- do not leave placeholders

### Russian version

The Russian version must come first.

Use natural Russian and avoid technical wording.

### English version

The English version must come after the Russian version.

Use natural English and avoid technical wording.

Do not make the English text more technical than the Russian text.

### Коротко / Summary

Write these last.

They should summarize the release in plain language.

### Что изменилось / What changed

This is the main section.

Use only subsections that have content.

### Исправили / Fixed

Include only meaningful user-facing fixes.

Do not include invisible test fixes.

### Технически / Technical notes

Keep short.

Explain why the technical change matters.

If there is no meaningful technical note, omit this section from both language versions.

### Что это значит для пользователя / What this means for users

Use this to end with practical value.

Do not overpromise.

### Полный список изменений / Full changelog

This should be a short readable changelog, not commit messages.

Use grouped changes, not every commit.

---

## Translation consistency rules

Generate the Russian version first.

Then produce the English version from the same grouped release notes.

Before finalizing, verify:

- both language versions describe the same changes
- no item exists only in one language unless it is intentionally omitted because the section itself is empty
- the English version does not add unsupported claims
- the Russian version does not add unsupported claims
- titles match the same release theme
- section omissions are consistent across both languages

---

## Examples of translation

Bad:

```md
* Updated selectors in content script.
```

Good Russian:

```md
* **Больше цен на странице:** расширение стало надежнее находить цены в разных блоках AV.by.
```

Good English:

```md
* **More prices detected:** the extension should now find prices more reliably across different AV.by page blocks.
```

Bad:

```md
* Added fallback for API errors.
```

Good Russian:

```md
* **Курсы не пропадают при сбое:** если API курсов временно недоступен, расширение может продолжить работу с последними сохраненными курсами.
```

Good English:

```md
* **Rates do not disappear on errors:** if the exchange-rate API is temporarily unavailable, the extension can keep working with the last saved rates.
```

Bad:

```md
* Refactored popup.
```

Good Russian:

```md
* **Попап стал понятнее:** выбор валюты, курсы и конвертер теперь легче воспринимаются в одном окне.
```

Good English:

```md
* **Clearer popup:** currency selection, exchange rates, and the converter are easier to understand in one place.
```

Bad:

```md
* Added tests for formatDisplayPrice.
```

Good Russian:

```md
* **Формат цен стал надежнее:** добавили проверки, чтобы суммы отображались аккуратно и одинаково в разных сценариях.
```

Good English:

```md
* **More reliable price formatting:** added checks so amounts are displayed consistently across different cases.
```

---

## Final self-check

Before writing the final output, verify:

1. The release notes contain both Russian and English versions.
2. Russian comes first.
3. Both language versions describe the same verified changes.
4. The text is understandable for a non-technical user.
5. No raw commit messages remain.
6. Every claim is supported by Git evidence.
7. No unsupported metrics or promises are included.
8. Technical details are secondary and short.
9. Empty sections are omitted consistently.
10. `release_title_ru` is 2–5 Russian words.
11. `release_title_en` is 2–5 English words.
12. The Russian heading equals `release_title_ru`.
13. The English heading equals `release_title_en`.
14. The final changelog is useful, not just complete.
15. The final file has no template placeholders.
16. The output is valid Markdown.

---

## Output behavior

If file writing is supported:

- create the target directory if missing
- write the final Markdown file
- overwrite existing target file
- use UTF-8
- preserve one trailing newline
- do not modify source files

After writing, output only:

```text
✅ Release notes created

Path:
- <target path>

Russian title:
- <release_title_ru>

English title:
- <release_title_en>
```

If file writing is not available:

- output only the final Markdown content
