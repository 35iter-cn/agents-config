---
name: magicdoor-solid-use-case
description: Use when working in a project that uses @magicdoor/solid-use-case and the task may add, modify, debug, or refactor gateway, use case, presenter, AppState, or component boundaries.
category: framework
risk: medium
source: generated
date_added: '2026-04-17'
---

# Working with Solid Use-Case

## Overview

`@magicdoor/solid-use-case` is not just a folder convention. It defines a runtime model:

- `UseCase` owns writes to shared app state
- `Presenter` subscribes to app-state changes and projects view models
- `useUseCase` and `usePresenter` are the component wiring layer

Build and repair modules by respecting that runtime model, not by treating the four layers as a naming scheme.

Core principle: external I/O stops at the gateway, shared business-state writes stop at the use case, view shaping stops at the presenter, and components only handle rendering plus local UI events.

## When to Use

Use when:

- adding or extending a feature in a project that uses `@magicdoor/solid-use-case`
- modifying `AppState`, gateways, use cases, presenters, or route/component wiring
- moving business logic out of components
- fixing bugs where state is correct but the UI is wrong
- fixing bugs where a component patch would duplicate a shared rule
- debugging initialization, loading, or presenter subscription behavior

Do not use this skill for generic SolidJS UI work that does not touch the `solid-use-case` architecture.

## Runtime Truths

These behaviors matter because they determine the correct architecture.

| Piece | Real behavior | Architectural consequence |
| --- | --- | --- |
| `AppState` | one shared state instance backs the app | shared business data belongs here, not in component-local state |
| `UseCase` | reads and writes shared state, and executes through a framework-managed lifecycle | shared business decisions and state mutation belong here |
| `UseCase.execute()` | may initialize state before running logic and may deduplicate concurrent executions for the same class plus params | treat `execute()` as a framework-managed execution entrypoint, not as a button for forcing duplicate side effects |
| `initializeState()` | framework bootstrap hook for binding or preparing app state | business code must not call it directly as a reset or page-load helper; use ordinary use cases or app-level initialization orchestration instead |
| `Presenter` | subscribes to app-state changes and reruns `createModel(state)` | presenters are read-only projection units, not custom reactive hooks or side-effect containers |
| `useUseCase` | exposes hook-managed execution state such as loading, success, progress, and error routing | components should not rebuild shared async orchestration themselves |
| `usePresenter` | exposes a reactive model accessor backed by presenter subscription | components should consume `model()` as subscription-backed state, not as an ad hoc recompute helper |

Treat these as framework truths. Local project wrappers may rename things, but they do not change the role boundaries.

## Project Adaptation

Before editing, confirm the local equivalents for:

- the project-specific `MagicUseCase` base class
- the actual `AppState` shape
- gateway base helpers for auth, headers, and error mapping
- app-level initialization use cases
- any project rule that narrows presenter purity or route wiring further

Do not hardcode assumptions such as `state.user`, `src/gateways`, or a specific swagger path unless the current project actually uses them.

## Layer Boundaries

| Layer | Allowed to know | Must not do |
| --- | --- | --- |
| Gateway | transport details, DTOs, URLs, headers, auth, request and response mapping | mutate shared app state, format UI labels, decide UI behavior; let Swagger types leak out of this layer |
| Use case | business flow, state reads and writes, navigation, coordination across gateways | return JSX, shape view models, depend on presenter code |
| Presenter | current app-state snapshot and pure derived display data | call gateways, mutate shared state, trigger navigation, own browser side effects |
| Component or route | local UI state, event wiring, calling `execute()`, reading `model()` | call gateways directly, duplicate shared business rules, depend on transport DTOs |

## Placement Rules

### Put logic in the gateway when

- it builds request URLs, query strings, headers, or bodies
- it knows DTO field names or transport-only enums
- it maps backend payloads into domain data
- it translates transport errors into app-level errors

### Gateway Swagger type rules

- Use Swagger-generated types to declare and validate API request bodies and response shapes inside the gateway.
- Gateway method signatures must return internal domain types, never a Swagger type.
- Map every Swagger response to a domain object explicitly before returning it.
- No other layer may import or depend on Swagger types.

### Put logic in the use case when

- it decides whether to fetch, retry, merge, reset, select, or clear shared state
- it coordinates multiple gateway calls
- it validates a shared business action before committing state
- it updates shared app state
- it navigates after a business outcome

### Put logic in the presenter when

- it derives labels, badges, flags, grouped sections, rows, empty states, or fallback strings
- it formats values for display
- it turns one state snapshot into the exact shape the UI wants
- the result is still a pure projection of state, even if only one screen currently uses it

### Keep logic in the component only when

- it is local UI state such as dialog visibility, selected tab, expansion, or temporary form interaction
- it forwards user actions to `execute()`
- it renders `model()` output

If a rule affects more than one interaction, screen, or future consumer, do not leave it in the component just because the current use is small.

If a value must stay consistent across interactions, influence business decisions, survive navigation or refresh, or be consumed outside the current component, it belongs in shared app state and use-case flow rather than local component state.

## Required Workflow

### For a new or extended module

1. Start from the domain and state shape.
2. Add or adjust domain types.
3. Add the minimal shared state slot needed for the feature.
4. Add or extend gateway methods that map transport data into domain data.
5. Add a use case that performs the business flow and writes shared state.
6. Add a presenter that shapes shared state into view data.
7. Wire the component or route with `useUseCase` and `usePresenter`.
8. Test the behavior at the lowest layer that proves it.

### For a bug or refactor in existing code

Debug from the bottom up, in this order:

1. gateway mapping
2. use-case writes and business decisions
3. presenter projection
4. component consumption

Do not start with a component patch unless you have already proved the lower layers are correct.

## Non-Negotiable Rules

- Only gateway code may know transport-specific DTO shapes.
- Swagger types may be used inside gateways to declare request bodies and API response shapes, but they must never leak out of the gateway layer.
- Never call a gateway directly from a route or component.
- Never mutate shared app state from a presenter.
- Never import presenter logic into a use case.
- Never use `initializeState()` as a manual reset, page-load helper, or callback container.
- Never rebuild shared loading, success, or error orchestration in a component when `useUseCase` already provides it.
- Never fix a shared business rule by patching only one component.
- Never rely on repeated `execute()` calls to force duplicate side effects if the framework may deduplicate concurrent executions.

## Red Flags

Any of these means the logic is in the wrong place until proven otherwise:

- a component imports a gateway
- Swagger types appear outside the gateway layer
- a presenter performs I/O or navigation
- a use case imports from a presenter module
- a component contains shared eligibility, status, or selection rules
- the same fallback string, badge rule, or action-enable rule appears in multiple components
- a component copies loading or success state that should come from `useUseCase`
- a presenter is written as a custom reactive hook instead of a `Presenter` subclass
- code manually calls `initializeState()` from business logic or UI code
- a fix changes only JSX conditionals without checking gateway, use case, and presenter layers first

## Common Rationalizations

| Excuse | Reality |
| --- | --- |
| "Only this page uses it" | If it is shared business or shared display logic, it still belongs below the component. |
| "This is just presentation" | Labels, flags, grouping, and formatting are presenter work, not ad hoc component work. |
| "Hotfix first, architecture later" | Component-only patches usually duplicate a broken shared rule and create the next bug. |
| "I will just call the gateway directly here" | That bypasses hook-managed execution, error handling, and state flow. |
| "initializeState sounds like the right place" | It is framework bootstrap, not a general-purpose business API. |
| "I need my own loading state for control" | Rebuilding hook semantics in the component usually means the logic is leaking upward. |
| "It is safer to keep everything in the use case" | Display shaping in use cases couples business flow to UI requirements. |

## Shared Logic Extraction

If both a use case and a presenter need the same transformation, do not make the use case depend on the presenter.

Move the shared logic to a neutral module such as:

- a domain helper near the entity or type
- a transport mapper if it is still DTO-specific
- a focused pure utility that depends only on domain data

Dependency direction must continue to point toward neutral domain code, not upward into presentation.

## Minimal End-to-End Example

```typescript
// gateway
class ExampleGateway extends Gateway {
  getItems = async (): Promise<Item[]> => {
    const response = await this.sendRequest({
      url: '/items',
      method: RequestMethod.GET,
    });

    const json = await response.json();
    return json.items.map(mapItemDtoToDomain);
  };
}

// use case
export class GetItemsUseCase extends MagicUseCase {
  protected async runLogic(): Promise<void> {
    this.getState().items = await exampleGateway.getItems();
  }
}

// presenter
export class ItemsPresenter extends Presenter<PresentableItems> {
  protected createModel(state: AppStateShape): PresentableItems {
    return {
      items: (state.items ?? []).map((item) => ({
        id: item.id,
        title: item.name,
        canArchive: item.status === 'active',
      })),
    };
  }
}

// component
const ItemsPage = () => {
  const { execute, isLoading } = useUseCase(GetItemsUseCase);
  const { model } = usePresenter(ItemsPresenter);

  onMount(() => void execute());

  return <ItemList loading={isLoading()} items={model()?.items ?? []} />;
};
```

## Testing Strategy

- Gateway test: request shape, DTO mapping, transport edge cases
- Use-case test: state writes, resets, merges, navigation, business errors
- Presenter test: flags, formatting, grouping, empty states, fallback display values
- Component test: only when the UI interaction itself is the risk

When tests are sparse, add them at the lowest layer that proves the behavior. Do not rely on a component test to validate gateway mapping or shared business rules.

## Quick Review Before You Finish

- Can the gateway be understood without app-state knowledge?
- Can the use case be understood without reading JSX?
- Can the presenter be rerun from a plain state snapshot?
- Can the component be read as rendering plus event wiring only?
- Did you move the fix to the lowest correct layer instead of the fastest visible patch?
- Did you verify whether the problem was caused by bootstrap, state writes, presenter projection, or only component rendering?

If any answer is no, the boundaries are still wrong.
