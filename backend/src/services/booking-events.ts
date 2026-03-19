import { EventEmitter } from 'events';

const emitter = new EventEmitter();
emitter.setMaxListeners(200);

export function emitNewBookingRequest(businessId: number): void {
  emitter.emit(`booking:${businessId}`);
}

export function waitForBookingRequest(businessId: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const event = `booking:${businessId}`;
    let timer: ReturnType<typeof setTimeout>;

    function onEvent() {
      clearTimeout(timer);
      resolve(true);
    }

    timer = setTimeout(() => {
      emitter.removeListener(event, onEvent);
      resolve(false);
    }, timeoutMs);

    emitter.once(event, onEvent);
  });
}
