import { Injector, ResourceRef, inject } from "@angular/core";
import { toObservable } from "@angular/core/rxjs-interop";
import { filter, firstValueFrom, map } from "rxjs";
import { LAZY_RESOURCE_INJECTORS } from "./injector-registry";

/**
 * Triggers a (lazy) resource and resolves with its **first settled value**.
 *
 * A resource's `value()` is synchronous: right after the resource starts
 * loading it still returns the default value. `takeLazyResource` lets you
 * `await` the real server response instead, so the first read is never empty.
 *
 * - Triggers loading (works with {@link lazyResource}: accessing the resource
 *   kicks off its deferred loader).
 * - Waits until the resource reaches `'resolved'` (or `'local'`, when the value
 *   was set manually). Intermediate `'idle'` / `'loading'` / `'reloading'`
 *   states are skipped, so a default/empty value is never returned.
 * - Rejects with the resource's error if the loader fails (`'error'` status).
 *
 * @typeParam T The type of the resolved value.
 * @param ref The resource to await. Works with both `lazyResource` and a plain
 *   `resource()` (for the latter, pass `injector` if you are outside an
 *   injection context).
 * @param injector Optional injector. If omitted, the one captured by
 *   `lazyResource` is reused; otherwise `inject(Injector)` is used (which
 *   requires an injection context).
 * @returns A promise that resolves with the first real value, or rejects on error.
 *
 * @example
 * ```ts
 * // Inside an async method or an event handler:
 * const brands = await takeLazyResource(this.catalog.brands);
 * const filtered = brands.filter((b) => b.active);
 * ```
 */
export function takeLazyResource<T>(ref: ResourceRef<T>, injector?: Injector): Promise<T> {
  // Accessing a property triggers the lazy loader via the Proxy.
  const status = ref.status;
  const ownInjector = injector ?? LAZY_RESOURCE_INJECTORS.get(ref) ?? inject(Injector);

  const status$ = toObservable(status, { injector: ownInjector });

  return firstValueFrom(
    status$.pipe(
      filter((s) => s === "resolved" || s === "local" || s === "error"),
      map((s) => {
        if (s === "error") {
          throw ref.error() ?? new Error("zx-angular-lazy-resource: the resource failed to load.");
        }
        return ref.value();
      }),
    ),
  );
}
