# zx-angular-lazy-resource

> Lazy helpers for Angular's signal-based `resource()` — defer loading until first access, and `await` the first settled value as a Promise.

[![npm version](https://img.shields.io/npm/v/zx-angular-lazy-resource.svg)](https://www.npmjs.com/package/zx-angular-lazy-resource)
[![CI](https://github.com/zxnc/zx-angular-lazy-resource/actions/workflows/ci.yml/badge.svg)](https://github.com/zxnc/zx-angular-lazy-resource/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/zx-angular-lazy-resource.svg)](./LICENSE)

Two tiny, dependency-light utilities built on top of Angular's `resource()`:

- **`lazyResource()`** — a `resource()` that does **not** fire its request on app
  startup. The loader runs only the **first time the resource is accessed**.
- **`takeLazyResource()`** — `await` a resource and get its **first real value**
  (never the empty/default one), as a `Promise`.

---

## The problem

Angular's `resource()` is great, but its loader runs **as soon as the resource is
created**. If you keep a bunch of shared resources in a service…

```ts
@Service()
export class GlobalStore {
  private api = inject(Api);

  // ❌ Every one of these fires an HTTP request the moment the app boots,
  //    even if the user never opens the screen that needs them.
  readonly brands     = resource({ loader: () => this.api.getBrands(),     defaultValue: [] });
  readonly currencies = resource({ loader: () => this.api.getCurrencies(), defaultValue: [] });
  readonly vats       = resource({ loader: () => this.api.getVats(),       defaultValue: [] });
}
```

…you end up flooding your backend with requests at startup for data you may not
need yet.

`lazyResource()` fixes this: each resource waits until it is actually read.

```ts
@Service()
export class GlobalStore {
  private api = inject(Api);

  // ✅ No request until something reads `.value()` (template, computed, await, ...).
  readonly brands     = lazyResource(() => this.api.getBrands(),     []);
  readonly currencies = lazyResource(() => this.api.getCurrencies(), []);
  readonly vats       = lazyResource(() => this.api.getVats(),       []);
}
```

---

## Installation

```bash
npm install zx-angular-lazy-resource
```

**Peer dependencies:** `@angular/core` (>= 22) and `rxjs` (>= 7) — both already
present in any Angular app.

---

## Quick start

### 1. Declare lazy resources

```ts
import { Service, inject } from '@angular/core';
import { lazyResource } from 'zx-angular-lazy-resource';

@Service()
export class CatalogStore {
  private api = inject(CatalogApi);

  readonly brands = lazyResource(() => this.api.getBrands(), []);
}
```

### 2a. Use it synchronously (template / computed)

Reading `.value()` works exactly like a normal resource — and it transparently
triggers the load the first time:

```ts
@Component({
  template: `
    @if (store.brands.isLoading()) {
      <span>Loading…</span>
    } @else {
      @for (brand of store.brands.value(); track brand.id) {
        <div>{{ brand.name }}</div>
      }
    }
  `,
})
export class BrandsComponent {
  protected store = inject(CatalogStore);
}
```

### 2b. Use it asynchronously (`await` the first real value)

`value()` is synchronous, so on the very first read it may still be the default
(`[]`). When you need to be sure you have the server response, `await` it:

```ts
async function loadActiveBrands(store: CatalogStore) {
  const brands = await takeLazyResource(store.brands);
  return brands.filter((b) => b.active); // never runs on an empty default
}
```

A convenient pattern is to expose an `...Async` helper next to each resource:

```ts
@Service()
export class CatalogStore {
  private api = inject(CatalogApi);

  readonly brands = lazyResource(() => this.api.getBrands(), []);
  
  readonly brandsAsync = () => takeLazyResource(this.brands);
}

// somewhere else:
const brands = await store.brandsAsync();
```

---

## API

### `lazyResource<T>(loader, defaultValue, optionsOrInjector?)`

| Param               | Type                              | Description                                                                                |
| ------------------- | --------------------------------- | ------------------------------------------------------------------------------------------ |
| `loader`            | `() => Promise<T>`                | Async function that fetches the data. Runs once, on first access.                          |
| `defaultValue`      | `T`                               | Value exposed by `value()` before the loader resolves.                                     |
| `optionsOrInjector` | `LazyResourceOptions \| Injector` | Optional. An options object (see below) or, for backwards compatibility, a bare `Injector`. |

`LazyResourceOptions`:

| Property   | Type                  | Description                                                                                       |
| ---------- | --------------------- | ------------------------------------------------------------------------------------------------- |
| `id`       | `string` (optional)   | Enables Angular's **SSR `TransferState` caching** for this resource (see below).                  |
| `injector` | `Injector` (optional) | Only needed when called **outside** an injection context. Defaults to `inject(Injector)`.         |

**Returns** `ResourceRef<T>` — a normal resource ref (`value()`, `status()`,
`isLoading()`, `hasValue()`, `error()`, `reload()`, …). The only difference is
that the loader is deferred until the first property access.

#### SSR caching with `TransferState`

When an app renders on the server, the resource loader runs once to produce the
initial HTML; during hydration the browser would normally run the same loader
again. Provide an `id` to reuse the server result: Angular stores the resolved
value in `TransferState` on the server and uses it on the client to initialize
the resource in a `'resolved'` state.

```ts
@Service()
export class UserStore {
  private api = inject(UserApi);

  // The value resolved on the server is reused on the client — no second request.
  readonly user = lazyResource(() => this.api.getUser(), null, { id: 'current-user' });
}
```

The `id` must be **unique within your application** and **identical on the
server and the client** so Angular can match the cached entry.

> ⚠️ Because the cached value is serialized into the page's HTML, avoid using an
> `id` for resources that load **user-specific** data when the rendered HTML can
> be cached or shared between users.

The third argument is still backwards compatible with a bare `Injector`:

```ts
lazyResource(() => api.getBrands(), [], injector);          // injector only
lazyResource(() => api.getBrands(), [], { injector });      // injector via options
lazyResource(() => api.getBrands(), [], { id, injector });  // id + injector
```

### `takeLazyResource<T>(ref, injector?)`

| Param      | Type                  | Description                                                                                          |
| ---------- | --------------------- | --------------------------------------------------------------------------------------------------- |
| `ref`      | `ResourceRef<T>`      | The resource to await. Works with `lazyResource` and with a plain `resource()`.                     |
| `injector` | `Injector` (optional) | Reuses the injector captured by `lazyResource`; otherwise falls back to `inject(Injector)`.         |

**Returns** `Promise<T>` that:

- **resolves** with the first `'resolved'` (or `'local'`) value, and
- **rejects** with the resource's error if the loader fails.

> 💡 `takeLazyResource` can be called from anywhere — event handlers, `async`
> methods, etc. — because `lazyResource` captures the injection context for you.
> For a plain (non-lazy) `resource()` called outside an injection context, pass
> the `injector` argument explicitly.

---

## How it works

`resource()` documents that **if the `params` computation returns `undefined`,
the loader does not run and the resource stays `'idle'`**.

`lazyResource` gates `params` behind an `enabled` signal:

```ts
resource({
  params: () => (enabled() ? true : undefined), // undefined => loader never runs
  loader,
  defaultValue,
});
```

The returned resource is wrapped in a `Proxy`. The first time any property is
read, the proxy flips `enabled` to `true` (inside `untracked`, so it stays
side-effect-safe), which makes `params` produce a value and the loader runs
exactly once. Because the wrapper is a transparent `Proxy`, existing call sites
(`.value()`, `.status()`, …) keep working unchanged.

`takeLazyResource` listens to the resource's `status` signal (via
`toObservable`) and resolves the promise when it first settles.

---

## Notes & caveats

- **One request, then cached.** Once loaded, the value is cached by the
  resource. Call `ref.reload()` to fetch again.
- **`takeLazyResource` resolves on the first settled state.** If a `reload()` is
  in progress, `value()` may still hold the previous value (Angular's normal
  `'reloading'` behaviour).
- **SSR:** loading is access-driven; if you render on the server, accessing the
  resource during rendering triggers the load there too. Pass an `id` to cache
  the server-resolved value via `TransferState` and skip the loader on the
  client during hydration.
- **Reading is what triggers loading.** A resource that nothing ever reads will
  never fire its request — which is exactly the point.

---

## Compatibility

| Package        | Version  |
| -------------- | -------- |
| `@angular/core`| >= 22    |
| `rxjs`         | >= 7     |

`resource()` is stable as of Angular 22 (available as experimental in earlier
versions). This package targets the stable API, so Angular 22 is the minimum
supported version.

---

## Contributing

Issues and PRs are welcome. To build locally:

```bash
npm install
npm run build   # outputs to ./dist
```

---

## License

[MIT](./LICENSE) © zxnc
