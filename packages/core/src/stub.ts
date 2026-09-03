/** Placeholder used while a module is unimplemented; every call throws with the module name. Replaced module by module. */
export function stub<T extends object>(name: string): T {
  return new Proxy({} as T, { get: (_t, prop) => { if (prop === 'then') return undefined; return () => { throw new Error(`core module ${name}.${String(prop)} not implemented`); }; } });
}
