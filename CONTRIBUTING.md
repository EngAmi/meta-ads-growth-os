# Contributing to Meta Ads Growth OS

Thank you for your interest in contributing! This guide explains how to add new diagnostic rules, tRPC procedures, or UI features while keeping the codebase consistent and fully tested.

---

## Table of Contents

- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Adding a Diagnostic Rule](#adding-a-diagnostic-rule)
- [Adding a tRPC Procedure](#adding-a-trpc-procedure)
- [Adding a UI Feature](#adding-a-ui-feature)
- [Testing Guidelines](#testing-guidelines)
- [Pull Request Process](#pull-request-process)
- [Code Style](#code-style)

---

## Development Setup

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/meta-ads-growth-os.git
cd meta-ads-growth-os

# Install dependencies
pnpm install

# Copy environment template
cp .env.example .env
# Fill in DATABASE_URL, JWT_SECRET, META_APP_ID, META_APP_SECRET

# Push the database schema
pnpm db:push

# Start the development server
pnpm dev

# Run tests (must all pass before submitting a PR)
pnpm test
```

---

## Project Structure

The four files you will touch most often:

| File | Purpose |
|---|---|
| `drizzle/schema.ts` | Database tables and types — edit first, then run `pnpm db:push` |
| `server/db.ts` | Query helpers — raw Drizzle queries, reused across procedures |
| `server/routers/` | tRPC procedures — one file per feature domain |
| `client/src/pages/` | React page components — consume procedures via `trpc.*` hooks |

Engine-specific files:

| File | Purpose |
|---|---|
| `server/engines/diagnosticEngine.ts` | Rule evaluation logic — pure functions, fully unit-tested |
| `server/engines/pipeline.ts` | Pipeline step orchestration |
| `server/nightlyScheduler.ts` | Cron registration and duplicate-run guard |

---

## Adding a Diagnostic Rule

Diagnostic rules live in `server/engines/diagnosticEngine.ts`. Each rule is a pure function that takes a `EntityWindow` and returns a `StandardEvidence | null`.

### Step 1 — Define the rule ID and label

Open `diagnosticEngine.ts` and add your rule to the `RULE_LABELS` map:

```ts
// Existing rules: C1, C2, F1, F2, A1, S1
const RULE_LABELS: Record<string, string> = {
  C1: "CPL Spike",
  C2: "CPL Improvement",
  // ...
  X1: "Your New Rule Label",   // ← add here
};
```

### Step 2 — Write the evaluation function

Follow the existing pattern. Rules must:
- Accept `window: EntityWindow` as the only argument
- Return `StandardEvidence | null` (null = rule does not fire)
- Be a pure function with no side effects
- Guard against the minimum impression threshold

```ts
function evaluateX1(window: EntityWindow): StandardEvidence | null {
  if (window.impressions < MIN_IMPRESSIONS) return null;

  // Your logic here
  const condition = /* ... */;
  if (!condition) return null;

  return {
    ruleId: "X1",
    label: RULE_LABELS["X1"],
    severity: "warning",          // "info" | "warning" | "critical"
    entity: window.entityType,
    entityId: window.entityId,
    entityName: window.entityName,
    metric: "your_metric",
    observed: round2(window.yourMetric),
    baseline: round2(window.baseline.yourMetric),
    delta: relativeDelta(window.yourMetric, window.baseline.yourMetric),
    summary: `Your metric is ${round2(window.yourMetric)} vs baseline ${round2(window.baseline.yourMetric)}`,
  };
}
```

### Step 3 — Register the rule in `runDiagnosticEngine`

```ts
const evaluators = [
  evaluateC1, evaluateC2,
  evaluateF1, evaluateF2,
  evaluateA1, evaluateS1,
  evaluateX1,   // ← add here
];
```

### Step 4 — Write unit tests

Add a `describe("X1 — Your Rule Label")` block in `server/engines/diagnosticEngine.test.ts`. Every rule must have at minimum:
- A test that fires the rule (returns evidence)
- A test that does not fire (returns null)
- A test for the impression guard

```ts
describe("X1 — Your New Rule Label", () => {
  it("fires when condition is met", () => {
    const evidence = evaluateX1(makeWindow({ /* ... */ }));
    expect(evidence?.ruleId).toBe("X1");
  });

  it("returns null when condition is not met", () => {
    expect(evaluateX1(makeWindow({ /* ... */ }))).toBeNull();
  });

  it("returns null below minimum impressions", () => {
    expect(evaluateX1(makeWindow({ impressions: 100 }))).toBeNull();
  });
});
```

---

## Adding a tRPC Procedure

### Step 1 — Choose the right router file

Procedures are organised by domain under `server/routers/`. If your feature does not fit an existing domain, create a new file `server/routers/yourFeature.ts` and register it in `server/routers.ts`.

### Step 2 — Define the procedure

```ts
// server/routers/yourFeature.ts
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";

export const yourFeatureRouter = router({
  list: protectedProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Use ctx.user.id for the authenticated user
      return await getYourItems(input.workspaceId);
    }),

  create: protectedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      return await createYourItem(ctx.user.id, input.name);
    }),
});
```

### Step 3 — Register in the root router

```ts
// server/routers.ts
import { yourFeatureRouter } from "./routers/yourFeature";

export const appRouter = router({
  // existing routers...
  yourFeature: yourFeatureRouter,
});
```

### Step 4 — Consume in the UI

```tsx
const { data } = trpc.yourFeature.list.useQuery({ workspaceId });
const create = trpc.yourFeature.create.useMutation({
  onSuccess: () => utils.yourFeature.list.invalidate(),
});
```

---

## Adding a UI Feature

1. Create `client/src/pages/YourFeature.tsx` using shadcn/ui components.
2. Register the route in `client/src/App.tsx`.
3. Add a navigation entry in `client/src/components/DashboardLayout.tsx` if it belongs in the sidebar.
4. Use `trpc.*.useQuery` / `trpc.*.useMutation` — never introduce raw `fetch` or Axios.
5. Handle loading, empty, and error states explicitly.

---

## Testing Guidelines

- Run `pnpm test` before every commit — all 139 tests must pass.
- New diagnostic rules require at minimum 3 unit tests (see above).
- New tRPC procedures should have at least one integration test in `server/routers/*.test.ts`.
- Keep test helpers (like `makeWindow`) in the same test file unless shared across multiple suites.

---

## Pull Request Process

1. Fork the repository and create a branch: `git checkout -b feat/your-feature-name`
2. Make your changes following the guidelines above.
3. Run `pnpm test` — all tests must pass.
4. Run `npx tsc --noEmit` — no TypeScript errors.
5. Open a Pull Request with a clear description of what the rule/feature does and why.
6. Reference any related issues in the PR description.

PRs that add diagnostic rules without unit tests will not be merged.

---

## Code Style

- **TypeScript strict mode** is enabled — no `any` unless absolutely necessary.
- **Pure functions** for all engine logic — no database calls inside `diagnosticEngine.ts`.
- **tRPC procedures** stay under ~150 lines — split into sub-routers if they grow.
- **No hardcoded secrets** — all credentials come from environment variables.
- Prefer `const` over `let`; avoid mutation where possible.

---

Thank you for contributing to Meta Ads Growth OS!
