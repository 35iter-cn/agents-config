# Correctness review: behavior, degradation, concurrency, lookups

## Restore vs regression

A change that returns a feature to how it worked before an earlier PR is **not**
a regression. A regression breaks something that worked or adds a new failure.

Decide with history, not reasoning:

```bash
git show <commit>^:<path>        # state before the change
git log --oneline -10 -- <path>
git diff <A> <B> -- <path>
```

| Before | After | Verdict |
|---|---|---|
| Works | Still works | fine |
| Works | Broken / worse | regression |
| Not blocked | Blocked | depends on the requirement |

Severity: blocking (core operation impossible) → high (main feature, has a
workaround) → medium (secondary) → low (barely perceptible). Say which one you
mean; "regression" alone overstates a cosmetic change.

## Degradation must declare itself

`Fetch(..., [])`-style fallbacks turn "could not load" into "count is zero". A
snapshot that reports `Active leases: 0` because a page failed is lying, and a
paging accumulator has no partial-return channel: page 2 failing loses pages 1..N.

The correct shape is degrade **and** declare:

```csharp
facts.Add($"The {string.Join(" and ", unavailable)} data is unavailable; " +
          "lease counts and coverage facts in this snapshot may be incomplete.");
```

Every silently-empty fetch carries an `onFailure` registration, and the declaring
sentence widens with each new source.

## Concurrency

**Shared collection written from parallel callbacks.** `List<T>` mutated in
`Task.WhenAll` failure callbacks loses entries or faults on resize (turning a
partial failure into a 500). Use `ConcurrentQueue<T>` (`using
System.Collections.Concurrent;` is not in ImplicitUsings), `Enqueue` to match
`Action`, keep the read side as `IReadOnlyCollection<T>`.

**Parallel EF queries.** Safe only when the repository injects
`IDbContextFactory<T>` and creates a context per call. A scoped shared
`DbContext` forbids concurrency — check the injection before starting tasks.

```csharp
var propertiesTask = getProperties.Execute(propertyIds);
var unitsTask = getUnits.Execute(unitIds);
return new TenantLeasesEnvelope
{
    Leases = leases,
    Properties = await propertiesTask,
    Units = await unitsTask,
};
```

Start the tasks, then await inside the initializer — the property name carries
which result is which.

## Removing a null guard / fallback

Removing a fallback is not removing defense; it changes "impossible" into "dies
loudly when impossible". Prove impossibility first, all three:

1. The lookup implementation filters by id only — no `Active`, no company scope.
2. No soft-delete `HasQueryFilter` applies to the portal data.
3. FK constraints guarantee the referenced row exists.

Then swap `GetValueOrDefault` for the dictionary indexer / drop the nullable
parameter. A 500 is the correct signal for corrupted data; `"Unnamed Property"`
is a lie.

## Success gates

Place the gate where the operation is created, not where it is read:

- **Ensure / first create**: require `Success`.
- **Get**: no gate — a receipt issued before the transaction was returned/voided
  must still be readable.
- **Portal ExternalGet/Send**: keep the gate when the UI only offers the entry
  for `Payment + Success`; it is defense in depth, not duplication. Check the
  actual frontend condition rather than deleting by symmetry.

## Race and artifact ordering

A record whose file is part of its meaning: build and upload first, insert with a
required `FileId`, and on a create failure re-read the row — delete the orphan
only when the winner's `FileId` differs from yours.

Deleting the good file because the create threw is a data-loss bug, not cleanup.

## Response shape changes

Changing `[...]` to `{ items: [...] }` breaks consumers silently at runtime.
Before shipping: grep every consumer, put the unwrap in the repository layer so
components stay untouched, and say in the PR which consumer you checked.
