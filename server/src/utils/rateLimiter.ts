
export class RateLimitedQueue {
  private queue: Array<() => void> = [];
  private isProcessing = false;
  private intervalMs: number;

  constructor(qps: number) {
    this.intervalMs = Math.ceil(1000 / qps);
  }

  /**
   * Add a task to the queue.
   * The task will be executed when the rate limit allows.
   * @param fn An async function that returns a promise.
   */
  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const wrapper = async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      };
      this.queue.push(wrapper);
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (task) {
        // Execute the task (fire and forget, we don't wait for it to finish, only for the slot)
        task();
        
        // Wait for the interval to pass before processing the next task
        await new Promise(resolve => setTimeout(resolve, this.intervalMs));
      }
    }

    this.isProcessing = false;
  }
}
