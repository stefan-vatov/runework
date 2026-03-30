## 0.3.2 (2026-03-30)

### 🩹 Fixes

- restore constitutional scaffold boundaries ([b83c58a](https://github.com/stefan-vatov/runework/commit/b83c58a))

### ❤️ Thank You

- Stefan Vatov

## Unreleased

### 🩹 Fixes

- restore `runework-init` to a constitutional blank scaffold; consumer repos no longer receive `runework-pipelines` or starter pipeline re-exports

### ℹ️ Notes

- `0.3.0` briefly experimented with scaffolding dogfood pipeline re-exports into consumer repos. That behavior has been reverted so the runtime stays zero-out-of-the-box and consumer policy remains user-owned.

## 0.3.1 (2026-03-30)

### 🩹 Fixes

- simplify source wiring for pipelines ([8d8c7ec](https://github.com/stefan-vatov/runework/commit/8d8c7ec))

### ❤️ Thank You

- Stefan Vatov

## 0.3.0 (2026-03-29)

### 🚀 Features

- consume shared pipeline lib for dogfood ([77af80d](https://github.com/stefan-vatov/runework/commit/77af80d))
- update runework-init scaffold to generate dual dependencies and thin pipeline re-exports ([05ea081](https://github.com/stefan-vatov/runework/commit/05ea081))
- wire runework to runework-pipelines ([53abfe5](https://github.com/stefan-vatov/runework/commit/53abfe5))
- **runework-init:** derive runework-pipelines version from package metadata ([2c45e51](https://github.com/stefan-vatov/runework/commit/2c45e51))

### 🩹 Fixes

- restore local workspace installs ([f3789eb](https://github.com/stefan-vatov/runework/commit/f3789eb))
- widen setTimeout gaps in stream chunk ordering test ([71c0f11](https://github.com/stefan-vatov/runework/commit/71c0f11))
- use versioned release contract for runework-pipelines dependency ([7efa717](https://github.com/stefan-vatov/runework/commit/7efa717))
- VAL-CROSS-002 exercises actual dogfood context instead of comparing two fixtures ([c328199](https://github.com/stefan-vatov/runework/commit/c328199))
- VAL-CROSS-002 uses CLI for external consumer, direct runPipeline for dogfood ([a8e7323](https://github.com/stefan-vatov/runework/commit/a8e7323))
- use relative file: paths in runework-init scaffolded dependencies ([91260a2](https://github.com/stefan-vatov/runework/commit/91260a2))
- correct runework-pipelines path calculation in init.ts ([ef94ab2](https://github.com/stefan-vatov/runework/commit/ef94ab2))
- correct sibling path calculation in defaultRuneworkPipelinesDependency ([8424a03](https://github.com/stefan-vatov/runework/commit/8424a03))
- correct sibling runework-pipelines path - product files only ([d2e75cf](https://github.com/stefan-vatov/runework/commit/d2e75cf))
- correct sibling runework-pipelines path calculation ([8089119](https://github.com/stefan-vatov/runework/commit/8089119))
- **runework-init:** support --no-install smoke path when runework-pipelines unavailable ([28da0af](https://github.com/stefan-vatov/runework/commit/28da0af))

### ❤️ Thank You

- Stefan Vatov

## 0.2.0 (2026-03-28)

### 🚀 Features

- declarative stage pipelines and project constitution ([#3](https://github.com/stefan-vatov/hammerkit/pull/3))

### 🩹 Fixes

- keep releases working in stealth mode ([#4](https://github.com/stefan-vatov/hammerkit/pull/4))

### ❤️ Thank You

- Stefan Vatov

## 0.1.1 (2026-03-25)

### 🏡 Chore

- move to monorepo ([#1](https://github.com/stefan-vatov/hammerkit/pull/1))
- **release:** add nx release workflow ([#2](https://github.com/stefan-vatov/hammerkit/pull/2))

### ❤️ Thank You

- Stefan Vatov
