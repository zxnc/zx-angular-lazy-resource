import { Injector, ResourceRef, inject, resource, signal, untracked } from "@angular/core";
import { LAZY_RESOURCE_INJECTORS } from "./injector-registry";

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
 * @typeParam T The type of the resolved value.
 * @param loader An async function that fetches the data.
 * @param defaultValue The value exposed before the loader resolves.
 * @param injector Optional injector. Required only when calling `lazyResource`
 *   outside of an injection context (it defaults to `inject(Injector)`).
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
 * }
 * ```
 */
export function lazyResource<T>(loader: () => Promise<T>, defaultValue: T, injector?: Injector): ResourceRef<T> {
  const ownInjector = injector ?? inject(Injector);
  const enabled = signal(false);

  const ref = resource<T, boolean | undefined>({
    // While `enabled` is false, `params` is `undefined` => the loader never
    // runs and the resource stays idle.
    params: () => (enabled() ? true : undefined),
    loader,
    defaultValue,
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
