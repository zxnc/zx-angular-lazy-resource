import { Injector, ResourceRef, inject, resource, signal, untracked } from "@angular/core";
import { LAZY_RESOURCE_INJECTORS } from "./injector-registry";

/**
 * Options for {@link lazyResource}.
 */
export interface LazyResourceOptions {
  /**
   * A unique identifier that enables Angular's SSR `TransferState` caching for
   * this resource.
   *
   * When provided, Angular stores the value resolved on the server into
   * `TransferState` and reuses it on the client during hydration, initializing
   * the resource in a `'resolved'` state instead of running the loader again.
   *
   * The `id` must be **unique within your application** and **identical on the
   * server and the client** so Angular can match the cached entry.
   *
   * > ⚠️ Because the cached value is serialized into the page's HTML, avoid
   * > using an `id` for resources that load user-specific data when the
   * > rendered HTML can be cached or shared between users.
   */
  id?: string;

  /**
   * Optional injector. Required only when calling `lazyResource` outside of an
   * injection context (it defaults to `inject(Injector)`).
   */
  injector?: Injector;
}

/**
 * Creates a **lazy** Angular `resource()` whose `loader` does not run when the
 * resource is created (i.e. when your app boots), but only the first time the
 * resource is actually accessed.
 *
 * ### Why
 * A plain `resource()` starts loading immediately as soon as it is created.
 * When you keep many resources in a shared service, every single one fires an
 * HTTP request on app startup. `lazyResource` defers each request until the
 * data is genuinely needed.
 *
 * ### How
 * The trick relies on a documented `resource` behaviour: when the `params`
 * computation returns `undefined`, the loader does not run and the resource
 * stays in the `'idle'` state. We gate `params` behind an `enabled` signal that
 * flips to `true` the first time *any* property of the returned resource is
 * read. The resource is wrapped in a `Proxy` so accessing `.value()`,
 * `.status()`, `.reload()`, ... transparently triggers the load. Call sites do
 * not need to change.
 *
 * ### SSR / `TransferState`
 * Pass an `id` (via the options object) to enable Angular's SSR caching: the
 * value resolved on the server is stored in `TransferState` and reused on the
 * client during hydration, avoiding a second loader run. See
 * {@link LazyResourceOptions.id}.
 *
 * @typeParam T The type of the resolved value.
 * @param loader An async function that fetches the data.
 * @param defaultValue The value exposed before the loader resolves.
 * @param optionsOrInjector Either an {@link LazyResourceOptions} object (to set
 *   `id` and/or `injector`) or, for backwards compatibility, a bare `Injector`.
 *   The injector is required only when calling `lazyResource` outside of an
 *   injection context (it defaults to `inject(Injector)`).
 * @returns A `ResourceRef<T>` that behaves exactly like a normal resource,
 *   except its loader is deferred until first access.
 *
 * @example
 * ```ts
 * @Injectable({ providedIn: 'root' })
 * export class CatalogStore {
 *   private api = inject(CatalogApi);
 *
 *   // No request is made until something reads `brands.value()`.
 *   readonly brands = lazyResource(() => this.api.getBrands(), []);
 *
 *   // With SSR TransferState caching:
 *   readonly user = lazyResource(() => this.api.getUser(), null, { id: 'user' });
 * }
 * ```
 */
export function lazyResource<T>(
  loader: () => Promise<T>,
  defaultValue: T,
  optionsOrInjector?: LazyResourceOptions | Injector,
): ResourceRef<T> {
  const options = normalizeOptions(optionsOrInjector);
  const ownInjector = options.injector ?? inject(Injector);
  const enabled = signal(false);

  const ref = resource<T, boolean | undefined>({
    // While `enabled` is false, `params` is `undefined` => the loader never
    // runs and the resource stays idle.
    params: () => (enabled() ? true : undefined),
    loader,
    defaultValue,
    // When set, enables SSR `TransferState` caching for this resource.
    id: options.id,
    injector: ownInjector,
  });

  const proxy = new Proxy(ref, {
    get(target, prop, receiver) {
      // Reading any property is treated as "the consumer needs this data now".
      // `untracked` keeps the write side-effect free of reactive dependencies
      // and avoids "writing to a signal in a computed" errors.
      untracked(() => {
        if (!enabled()) {
          enabled.set(true);
        }
      });
      return Reflect.get(target, prop, receiver);
    },
  });

  LAZY_RESOURCE_INJECTORS.set(proxy, ownInjector);
  return proxy;
}

/**
 * Normalizes the third argument of {@link lazyResource}, which for backwards
 * compatibility may be either a bare `Injector` or a {@link LazyResourceOptions}
 * object. An `Injector` is detected by its `get` method.
 */
function normalizeOptions(optionsOrInjector?: LazyResourceOptions | Injector): LazyResourceOptions {
  if (!optionsOrInjector) {
    return {};
  }
  if (typeof (optionsOrInjector as Injector).get === "function") {
    return { injector: optionsOrInjector as Injector };
  }
  return optionsOrInjector as LazyResourceOptions;
}
