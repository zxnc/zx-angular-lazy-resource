import { Injector, ResourceRef, inject } from "@angular/core";
import { toObservable } from "@angular/core/rxjs-interop";
import { filter, firstValueFrom, map, skipWhile } from "rxjs";
import { LAZY_RESOURCE_INJECTORS } from "./injector-registry";

/**
 * Options for {@link takeLazyResource}.
 */
export interface TakeLazyResourceOptions {
  /**
   * When `true`, force the resource to fetch **fresh** data before resolving.
   *
   * `takeLazyResource` calls `ref.reload()` and waits for the value produced by
   * that reload, skipping any previously cached (`'resolved'`) value. This lets
   * a caller opt into up-to-date data on every call instead of reusing the
   * resource's cached result.
   *
   * If a reload turns out to be unnecessary or unsupported (e.g. a load is
   * already in flight), the first settled value is used instead, so the call
   * never hangs.
   *
   * @default false
   */
  reload?: boolean;

  /**
   * Optional injector. If omitted, the one captured by `lazyResource` is reused;
   * otherwise `inject(Injector)` is used (which requires an injection context).
   */
  injector?: Injector;
}

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
 * ### Fresh data on every call
 * Pass `{ reload: true }` to force a refetch: `takeLazyResource` calls
 * `ref.reload()` and resolves with the freshly loaded value instead of the
 * cached one. See {@link TakeLazyResourceOptions.reload}.
 *
 * @typeParam T The type of the resolved value.
 * @param ref The resource to await. Works with both `lazyResource` and a plain
 *   `resource()` (for the latter, pass `injector` if you are outside an
 *   injection context).
 * @param optionsOrInjector Either a {@link TakeLazyResourceOptions} object (to
 *   set `reload` and/or `injector`) or, for backwards compatibility, a bare
 *   `Injector`. If omitted, the injector captured by `lazyResource` is reused;
 *   otherwise `inject(Injector)` is used (which requires an injection context).
 * @returns A promise that resolves with the first real value, or rejects on error.
 *
 * @example
 * ```ts
 * // Inside an async method or an event handler:
 * const brands = await takeLazyResource(this.catalog.brands);
 * const filtered = brands.filter((b) => b.active);
 *
 * // Force fresh data on this call:
 * const fresh = await takeLazyResource(this.catalog.brands, { reload: true });
 * ```
 */
export function takeLazyResource<T>(
  ref: ResourceRef<T>,
  optionsOrInjector?: TakeLazyResourceOptions | Injector,
): Promise<T> {
  const options = normalizeOptions(optionsOrInjector);

  // Accessing a property triggers the lazy loader via the Proxy.
  const status = ref.status;
  const ownInjector = options.injector ?? LAZY_RESOURCE_INJECTORS.get(ref) ?? inject(Injector);

  const status$ = toObservable(status, { injector: ownInjector });

  const toValue = (s: string): T => {
    if (s === "error") {
      throw ref.error() ?? new Error("zx-angular-lazy-resource: the resource failed to load.");
    }
    return ref.value();
  };

  const isSettled = (s: string): boolean => s === "resolved" || s === "local" || s === "error";

  // Force a fresh fetch and resolve with the reloaded value. We only take this
  // path when `reload()` actually initiates a reload; otherwise we fall back to
  // the first settled value so the promise never hangs.
  if (options.reload && ref.reload()) {
    return firstValueFrom(
      status$.pipe(
        // Skip the (possibly cached) value settled before the reload kicks in,
        // up until the resource starts (re)loading.
        skipWhile((s) => s !== "loading" && s !== "reloading"),
        filter(isSettled),
        map(toValue),
      ),
    );
  }

  return firstValueFrom(status$.pipe(filter(isSettled), map(toValue)));
}

/**
 * Normalizes the second argument of {@link takeLazyResource}, which for
 * backwards compatibility may be either a bare `Injector` or a
 * {@link TakeLazyResourceOptions} object. An `Injector` is detected by its
 * `get` method.
 */
function normalizeOptions(optionsOrInjector?: TakeLazyResourceOptions | Injector): TakeLazyResourceOptions {
  if (!optionsOrInjector) {
    return {};
  }
  if (typeof (optionsOrInjector as Injector).get === "function") {
    return { injector: optionsOrInjector as Injector };
  }
  return optionsOrInjector as TakeLazyResourceOptions;
}
