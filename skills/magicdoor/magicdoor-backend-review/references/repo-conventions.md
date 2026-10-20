# Repo conventions reviewers enforce

Distilled from real review rounds on `MagicDoorInc/backend`. For anything not
listed, read the matching `backend/.ai-knowledge/*.md` file — this list is the
hot set, not the full spec.

## Comments

The repo iron rule: no comments. Code self-explains.

Reviewers delete, without discussion:

- XML doc and `//` comments that restate the member name (`/// <summary>The PM
  cancelled the request</summary>` above `Cancelled`).
- Comments narrating product intent or future behavior ("lets the frontend show
  a countdown without making the applicant guess").

A comment survives only for a *why* the code cannot show.

## Nullable util overloads

When a util ships nullable overloads, the `HasValue ? Convert(x.Value, tz) : null`
ternary is a smell.

```csharp
// Libs/Infrastructure/Default/DateUtil.cs
Convert(DateTime?, tz)        -> DateTimeOffset?
Convert(DateTimeOffset?, tz)  -> DateTime?
```

```csharp
CompletedAt = entity.CompletedAt.HasValue
    ? DateUtil.Convert(entity.CompletedAt.Value, tz)
    : null;                                   // smell

CompletedAt = DateUtil.Convert(entity.CompletedAt, tz);
```

Check the overload set and its return types first — the two directions are not
interchangeable.

## Business exceptions

```csharp
public class FooBarException() : Exception("...");            // never

using MagicDoor.Libraries.Infrastructure.Exceptions;
public class FooBarException() : MagicDoorException("...");   // always
```

Why it is a rule, not taste: `CommonExceptionsFilter.MapHttpException()` has a
dedicated `ex as MagicDoorException` branch that wraps cleanly. A raw-`Exception`
business error falls through to `return null` and is logged as **"Unhandled
exception"** at Error level — monitoring noise, and generalized
`catch (MagicDoorException)` sites never see it.

Re-basing an existing class is behavior-neutral when mapping is by exact type
(`switch` / `catch (ThatExactType)`), so the change is safe but stays scoped to
new exceptions in the PR. Legacy raw-`Exception` classes are separate debt.

## Controller return types

| Shape | Return |
|---|---|
| Single item / container DTO | bare `Task<TDto>` |
| List or paginated | bare `Task<TListDto>` (a container DTO) |
| Legacy `ActionResult<List<T>>` + `Ok()` | do not write in new code |

## Envelope vs DTO

- Internal **Envelope** carries raw entities plus the hydration lookup sets
  (`TenantLeasesEnvelope`). Name it `Envelope`, not `Result`.
- External **DTO** exposes only what the consumer needs, built by a static
  `From(envelope, timeZone, ...)` factory.
- Collections on models: `required` + `{ get; init; }`. Not positional records —
  same-typed parameters passed by position are unreadable, and adding a field
  breaks every call site.
- `Result` is reserved for **operation outcome** (`ToProblemResult`,
  `ObjectResult`). A fetched resource is never `*Result`: use `Envelope`,
  `HydratedX : XDto` + `[SetsRequiredMembers]`, or an honest `WithFile` wrapper.

## Logging

- Side-effect use cases (Ensure / Create / Send) inject `ILogger<T>`.
- Read-only `Get` / `List` / `Search` take no logger — no Trace on a hot path.
- Never `LogManager.GetCurrentClassLogger()` in new use cases.

## File policies

`IFilePolicy` for a business object lives in `Models/Policies/`, one per object —
not next to a use case, because it describes the object's attachment rules, not
one operation.

## Entities, DAL, EF Core

- 1:1 child table → the parent id **is** the PK:
  `[Key] [DatabaseGenerated(DatabaseGeneratedOption.None)] [Column("transaction_id")]`.
- `[ForeignKey(nameof(Id))]` + `[DeleteBehavior(DeleteBehavior.Cascade)]` go on
  the nav property, and the nav sits **before** `ToEntity()` and after all
  scalar columns.
- Audit objects (`EntityCreator`) persist as jsonb columns, not exploded fields:
  `[Column("last_sent_by", TypeName = "jsonb")] public EntityCreator? LastSentBy`.
- Adding a property inside an existing jsonb document needs no EF migration.
- A `DbSet` never sits inside an unrelated `#region`.

## Single id vs list queries

| Situation | Pattern |
|---|---|
| Caller already holds one PK (Ensure / Get / MarkSent / PDF / Portal GetVerified) | **A**: `Get(id)` → `NotFoundException.ThrowIfNull` → `ThrowIfNotCompany` |
| Real list, filter, multi-id, paging, search | **B**: `Filter { CompanyId, Ids }` → `FirstOrDefault` |

Pattern B on a known id collapses "missing" and "wrong company" into an empty
result, which callers then treat as "nothing there" — that is how a blank PaidBy
PDF got uploaded. Fail closed on a known id. Don't convert a list query into a
loop of `Get(id)`.

Company isolation may live in S2S/External while the pure domain Get stays
`Execute(long id) => repository.Get(id)`.

## Snapshots

Persist and expose raw fields only: amount, raw enum, reference, dates, frozen
name. Never a `PaymentMethodSummary`, `DisplayName` or `"$550.00"` string — that
assembly belongs to the user-facing renderer (PDF, or the frontend). A PDF and
the row it describes read **one** frozen snapshot, not two paths.

## Writes with side effects

- get-or-create takes a distributed lock keyed on the business unique key
  (`accounting-transaction-receipt-{companyId}-{transactionId}`).
- A record that requires a file produces the immutable artifact **first**, then
  inserts with a required `FileId`. No insert-then-attach.
- On a create race, re-read; delete the uploaded orphan **only if**
  `raced.FileId != fileId`, otherwise delete and rethrow.
- Resolve party names once (Tenant → Owner → Vendor), freeze into the snapshot;
  the file builder never re-queries the parent.

## Filter DTOs on query strings

`[FromQuery] XxxFilterDto filter` binds property by property, so the URL stays
flat — no `?filter=` prefix. Adding `[Required]` means the DataAnnotations using
follows into the DTO file. When changing one endpoint, change its isomorphic
siblings (owners/vendors, tenants/PMs) in the same PR.

A new list filter field reaches every layer: entity filter → internal DTO →
internal mapping → repository `ApplyFilter` → S2S DTO → S2S mapping → client
`BuildFilterUrl` → fake client → tests. A missing mapping silently ignores the
parameter.

Search: `!string.IsNullOrWhiteSpace(filter.Search)` and `.ToLower().Contains(...)`.
List filters: `List<T>?` where `null` = no filter and `[]` = empty result.
