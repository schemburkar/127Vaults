// Major 0 purchases include the first stable release.
export const SERVER_MAJOR_VERSION = 0;
export function compatiblePersonalMajor(purchased, running) {
  return Number.isSafeInteger(purchased) && purchased >= 0
    && Number.isSafeInteger(running) && running >= 0
    && Math.max(1, purchased) === Math.max(1, running);
}
