import type { Injector } from "@angular/core";

/**
 * Internal registry mapping each lazy resource proxy to the `Injector` it was
 * created in. This lets `takeLazyResource` await a resource from *outside* an
 * injection context (e.g. inside an event handler or an `async` method).
 *
 * Not part of the public API.
 */
export const LAZY_RESOURCE_INJECTORS = new WeakMap<object, Injector>();
