export async function runConcurrent<T>(
    items: T[],
    worker: (item: T, index: number) => Promise<void>,
    concurrency: number,
): Promise<void> {
    if (items.length === 0) {
        return;
    }

    let cursor = 0;
    const poolSize = Math.max(1, Math.min(concurrency, items.length));

    async function runOne() {
        while (true) {
            const index = cursor;
            cursor += 1;
            if (index >= items.length) {
                return;
            }
            await worker(items[index], index);
        }
    }

    await Promise.all(Array.from({ length: poolSize }, () => runOne()));
}

export async function withRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number,
    delayMs = (attempt: number) => Math.min(1000 * 2 ** attempt, 8000),
): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            if (attempt >= maxRetries) {
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, delayMs(attempt)));
        }
    }
    throw lastError;
}
