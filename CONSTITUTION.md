# CONSTITUTION

Ratified: 2026-03-26

---

## Preamble

Every major AI coding agent — Claude Code, Codex, OpenCode — is powerful on its own. But developers don't use one tool. They plan with one, build with another, review with a third. They run overnight loops, cross-provider comparisons, multi-stage review cycles. And they do all of it manually, with fragile scripts that break when a CLI updates, crash without recovery, and live in one developer's dotfiles instead of the team's repo.

runework exists because this workflow layer was missing. Not another agent. Not another orchestrator. Not another framework. A thin runtime — small enough to embed as a dependency, powerful enough to make AI coding workflows durable, typed, and portable across providers.

The gap runework fills is precise: between the engines (the coding agents themselves) and the policy (each team's prompts, rules, and practices). runework is the execution substrate. It does not tell you how to work with AI. It makes however you already work repeatable, resumable, and inspectable.

This is a category that did not exist before this project created it.

---

## Founding Principles

**1. Primitives, not opinions.**
runework provides building blocks — adapters, durable steps, typed pipelines, journaling. It never prescribes how to use them. Workflows, prompts, review criteria, and engineering policy belong to the teams that write them, not to this runtime.
*Rejects: batteries-included frameworks, opinionated starter workflows, built-in prompt libraries, prescribed methodologies.*

**2. The truth of each engine.**
Every adapter exposes what the underlying CLI actually supports — no shims, no fake parity, no lowest-common-denominator contracts. Capabilities are declared honestly. Differences between providers are features, not bugs. Agents and humans alike make better decisions when the real surface is visible.
*Rejects: provider homogenization, compatibility shims that hide limitations, artificial feature parity.*

**3. Thin enough to embed, powerful enough to resume.**
runework is a dependency, not a platform. It must stay small enough that any repository can add it without adopting a framework. But within that constraint, durability is non-negotiable: steps cache, checkpoints persist, crashed runs resume.
*Rejects: becoming a platform, requiring infrastructure, growing into an orchestration product.*

**4. Workflows are code, not configuration.**
Pipeline definitions are TypeScript — real types, real control flow, real imports. Not YAML. Not a DSL. Not a drag-and-drop UI. TypeScript on zx gives you bash and a full programming language in one, which is a strict upgrade over shell scripts.
*Rejects: YAML-driven workflow definitions, visual pipeline builders, proprietary DSLs.*

**5. Built for agents to use, not just humans.**
runework is designed from the start to be invoked by AI coding agents, not only by humans at a terminal. Structured inputs, structured outputs, honest capability surfaces, and deterministic execution make runework legible to the machines that run on it.
*Rejects: human-only UX assumptions, prose-based interfaces, workflows that require human judgment to parse.*

**6. Zero out of the box.**
runework ships no workflows, no pipelines, no review logic, no prompts. It ships the substrate. Reusable implementations are authored by users and shared as packages that import runework as a foundation. The ecosystem builds on top; the runtime stays beneath.
*Rejects: starter templates as product, curated workflow marketplaces, demos that hide the actual primitives.*

**7. Earn the abstraction.**
If a developer only needs `claude -p "review this"`, they should type exactly that. runework becomes worth it when you need durability, typed handoffs, provider composition, or reusable workflows. Every layer of complexity must justify itself against the shell script alternative.
*Rejects: framework tax on simple cases, abstractions that don't unlock new capabilities, complexity that exists to look sophisticated.*

---

## Growth Directives

**Toward broad provider coverage.** Expand the adapter layer to cover the full spectrum of CLI coding agents — Gemini CLI, Aider, and whatever emerges next. The more engines runework can compose, the stronger the case for the runtime layer.

**Toward an ecosystem of shareable workflows.** Enable a world where reusable pipelines and workflow libraries are published as npm packages, pasted between repos, or forked from public repositories — all built on runework primitives. The runtime is the foundation; the community builds the catalog.

**Toward environment agnosticism.** runework should run wherever TypeScript runs — local terminals, CI pipelines, overnight batch jobs, remote servers. The primitives don't care where they execute. Never optimize for one environment at the cost of another.

**Toward composability with adjacent tools.** Because runework is built on zx and ships as a library, other developers can build complementary packages around it — TUI layers, reporting tools, workflow registries, CI integrations. Encourage this by keeping the API surface clean and the primitives stable.

---

## Boundaries

**Never become an orchestrator.** runework will never own worktree management, process supervision, tmux sessions, task queues, dashboards, or issue routing. Those are orchestration product concerns. runework is the execution substrate beneath orchestration, not the orchestrator itself.

**Never own methodology.** runework will never ship prompts, planning systems, context engineering tools, skill loaders, AGENTS.md parsers, or coding rules. Those belong to the agent harnesses and to each consuming team. runework does not care what the agents read or how they are configured — it cares how they execute.

**Never become a platform.** runework is a library and a thin CLI. It requires no hosted services, no cloud infrastructure, no accounts, no daemon processes. If using runework ever requires running a server, the project has crossed a line.

**Never prescribe workflow patterns.** runework will never ship "recommended" pipelines, "best practice" review loops, or "starter" workflows that embed engineering opinions. The runtime provides step, checkpoint, spawn, and repeatUntil. What users build with those is their business.

**Never abstract away the engines.** runework will never insert itself between the user and the underlying CLI tool in a way that hides what command is being run, what arguments are being passed, or what output is being returned. Transparency is not optional.

---

## Tension Pairs

**Leverage over surface area — but never at the cost of adding dead weight.**
Every new primitive must deliver multiplicative power relative to the API surface it adds. A 1:1 ratio is not enough. If a feature doesn't unlock capabilities far beyond its footprint, it doesn't belong in the runtime. But never use this as an excuse to under-invest in a primitive that genuinely multiplies what users can build.

**Provider fidelity over human convenience — but never at the cost of a well-defined interface.**
runework is built for AI agents to use. Agents handle provider quirks better than humans — they thrive on clear, honest interfaces and struggle with hidden abstractions. Exposing the true capability surface IS the convenience. But the interface itself must always be well-structured and documented, never raw or chaotic.

**Passthrough over wrapping — but never at the cost of the adapter contract.**
Adapter primitives should be timeless and few. Provider-specific flags, new capabilities, and CLI updates should flow through via extraArgs and escape hatches so that consumers can adopt changes without waiting for runework to update. But the core adapter contract (run, capabilities, structured output) must remain stable and reliable.

**Library-first over CLI-first — but never at the cost of core DX.**
runework is a library that happens to have a CLI, not the reverse. The CLI surface stays thin and focused on what the runtime does. Extended UX — custom TUIs, interactive prompts, rich reporting — belongs in consumer packages that import runework and add their own presentation layer.

---

## Amendments

This constitution is intended to be foundational and rarely changed. It captures principles that should outlast any particular technology choice, provider, or market condition.

When a principle no longer holds or a new one must be added, update this document directly and record the change below.

### Amendment Log

| Date | Section | Change | Rationale |
|------|---------|--------|-----------|
| — | — | — | — |
