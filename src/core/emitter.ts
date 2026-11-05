/** Minimal strongly typed event emitter. `on` returns an unsubscribe function. */
export class Emitter<Events extends object> {
  private readonly handlers = new Map<keyof Events, Set<(payload: never) => void>>();

  on<K extends keyof Events>(type: K, handler: (payload: Events[K]) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(handler as (payload: never) => void);
    return () => this.off(type, handler);
  }

  off<K extends keyof Events>(type: K, handler: (payload: Events[K]) => void): void {
    this.handlers.get(type)?.delete(handler as (payload: never) => void);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    for (const handler of [...(this.handlers.get(type) ?? [])]) {
      (handler as (payload: Events[K]) => void)(payload);
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
