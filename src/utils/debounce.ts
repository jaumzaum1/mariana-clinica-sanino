export type DebouncedFunction<TArgs extends unknown[]> = (...args: TArgs) => void;

export function debounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  delayMs: number
): DebouncedFunction<TArgs> {
  let timeout: NodeJS.Timeout | undefined;

  return (...args: TArgs) => {
    if (timeout) {
      clearTimeout(timeout);
    }

    timeout = setTimeout(() => fn(...args), delayMs);
  };
}
