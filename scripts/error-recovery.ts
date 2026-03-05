/**
 * Error Recovery System
 * Handles transient failures, retries with exponential backoff, and graceful degradation
 */

export interface RecoveryConfig {
  maxRetries: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  backoffMultiplier: number;
  timeoutMs: number;
}

export const DEFAULT_RECOVERY_CONFIG: RecoveryConfig = {
  maxRetries: 5,
  initialBackoffMs: 500,
  maxBackoffMs: 30000,
  backoffMultiplier: 2,
  timeoutMs: 60000,
};

/**
 * Retry wrapper with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: RecoveryConfig = DEFAULT_RECOVERY_CONFIG,
  operationName: string = "Operation"
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      console.log(`🔄 ${operationName} (attempt ${attempt}/${config.maxRetries})`);
      
      // Execute with timeout
      const result = await Promise.race([
        fn(),
        new Promise<T>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Timeout after ${config.timeoutMs}ms`)),
            config.timeoutMs
          )
        ),
      ]);

      console.log(`✅ ${operationName} succeeded`);
      return result;
    } catch (error: any) {
      lastError = error;
      
      if (attempt === config.maxRetries) {
        console.error(
          `❌ ${operationName} failed after ${config.maxRetries} attempts: ${error.message}`
        );
        break;
      }

      // Calculate backoff
      const backoffMs = Math.min(
        config.initialBackoffMs * Math.pow(config.backoffMultiplier, attempt - 1),
        config.maxBackoffMs
      );

      console.warn(
        `⚠️  ${operationName} failed (attempt ${attempt}): ${error.message}. Retrying in ${backoffMs}ms...`
      );

      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }

  throw lastError || new Error(`${operationName} failed after ${config.maxRetries} attempts`);
}

/**
 * Circuit breaker pattern - fail fast after repeated failures
 */
export class CircuitBreaker {
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number = 0;
  private state: "closed" | "open" | "half-open" = "closed";

  constructor(
    private failureThreshold: number = 5,
    private successThreshold: number = 2,
    private resetTimeoutMs: number = 60000
  ) {}

  /**
   * Execute operation with circuit breaker
   */
  async execute<T>(
    fn: () => Promise<T>,
    operationName: string = "Operation"
  ): Promise<T> {
    // Check if circuit should open
    if (this.state === "open") {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure > this.resetTimeoutMs) {
        console.log(`🔄 Circuit breaker transitioning to half-open`);
        this.state = "half-open";
        this.successCount = 0;
      } else {
        throw new Error(
          `Circuit breaker is OPEN (${operationName}). Failing fast.`
        );
      }
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error: any) {
      this.recordFailure();
      throw error;
    }
  }

  private recordSuccess() {
    this.failureCount = 0;
    
    if (this.state === "half-open") {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        console.log(`✅ Circuit breaker CLOSED`);
        this.state = "closed";
      }
    }
  }

  private recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold) {
      console.error(
        `🔴 Circuit breaker OPEN (${this.failureCount} failures)`
      );
      this.state = "open";
    }
  }

  getState() {
    return this.state;
  }

  reset() {
    this.failureCount = 0;
    this.successCount = 0;
    this.state = "closed";
  }
}

/**
 * Request deduplication - prevent duplicate requests in flight
 */
export class RequestDeduplicator<T> {
  private inFlightRequests: Map<string, Promise<T>> = new Map();

  async execute(
    key: string,
    fn: () => Promise<T>
  ): Promise<T> {
    // Return existing request if already in flight
    if (this.inFlightRequests.has(key)) {
      console.log(`📦 Reusing in-flight request: ${key}`);
      return this.inFlightRequests.get(key)!;
    }

    // Start new request
    const promise = fn()
      .then(result => {
        this.inFlightRequests.delete(key);
        return result;
      })
      .catch(error => {
        this.inFlightRequests.delete(key);
        throw error;
      });

    this.inFlightRequests.set(key, promise);
    return promise;
  }

  getInFlightCount(): number {
    return this.inFlightRequests.size;
  }

  clear() {
    this.inFlightRequests.clear();
  }
}

/**
 * Fallback handler - graceful degradation on failure
 */
export async function withFallback<T>(
  primary: () => Promise<T>,
  fallback: () => Promise<T> | T,
  operationName: string = "Operation"
): Promise<T> {
  try {
    console.log(`🎯 Attempting primary: ${operationName}`);
    return await primary();
  } catch (primaryError: any) {
    console.warn(
      `⚠️  Primary failed: ${operationName}. Attempting fallback...`
    );
    try {
      return await Promise.resolve(fallback());
    } catch (fallbackError: any) {
      console.error(`❌ Both primary and fallback failed: ${operationName}`);
      throw fallbackError;
    }
  }
}

/**
 * Bulkhead pattern - isolate resource pools to prevent cascading failures
 */
export class ResourcePool {
  private available: number;
  private inUse: number = 0;
  private waitQueue: {
    resolve: () => void;
    reject: (error: Error) => void;
  }[] = [];

  constructor(capacity: number) {
    this.available = capacity;
  }

  /**
   * Acquire a resource from the pool
   */
  async acquire(timeoutMs: number = 30000): Promise<void> {
    if (this.available > 0) {
      this.available--;
      this.inUse++;
      return;
    }

    // Queue and wait
    console.log(`📊 Resource pool full. Waiting... (${this.inUse}/${this.available + this.inUse} in use)`);
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          const index = this.waitQueue.indexOf({ resolve, reject });
          if (index > -1) {
            this.waitQueue.splice(index, 1);
          }
          reject(new Error("Resource acquisition timeout"));
        },
        timeoutMs
      );

      this.waitQueue.push({
        resolve: () => {
          clearTimeout(timeout);
          this.available--;
          this.inUse++;
          resolve();
        },
        reject,
      });
    });
  }

  /**
   * Release a resource back to the pool
   */
  release(): void {
    this.inUse--;

    if (this.waitQueue.length > 0) {
      const waiter = this.waitQueue.shift();
      if (waiter) {
        waiter.resolve();
      }
    } else {
      this.available++;
    }
  }

  getStats() {
    return {
      Available: this.available,
      InUse: this.inUse,
      Waiting: this.waitQueue.length,
      Total: this.available + this.inUse,
    };
  }
}

/**
 * Graceful shutdown coordination
 */
export class ShutdownCoordinator {
  private shutdownHandlers: (() => Promise<void>)[] = [];
  private isShuttingDown: boolean = false;

  /**
   * Register a shutdown handler
   */
  onShutdown(handler: () => Promise<void>): void {
    this.shutdownHandlers.push(handler);
  }

  /**
   * Initiate graceful shutdown
   */
  async shutdown(timeoutMs: number = 30000): Promise<void> {
    if (this.isShuttingDown) return;

    this.isShuttingDown = true;
    console.log(`\n🛑 Initiating graceful shutdown (timeout: ${timeoutMs}ms)`);

    const startTime = Date.now();
    let completed = 0;

    for (const handler of this.shutdownHandlers) {
      try {
        const elapsed = Date.now() - startTime;
        if (elapsed > timeoutMs) {
          console.warn(`⚠️  Shutdown timeout - force closing`);
          break;
        }

        await handler();
        completed++;
        console.log(`   ✅ Shutdown handler ${completed}/${this.shutdownHandlers.length} completed`);
      } catch (error: any) {
        console.error(`   ❌ Shutdown handler failed: ${error.message}`);
      }
    }

    console.log(`✅ Graceful shutdown complete (${completed}/${this.shutdownHandlers.length} handlers)`);
  }
}

/**
 * Health monitoring - track system health metrics
 */
export class HealthMonitor {
  private errorCounts: Map<string, number> = new Map();
  private warnings: { time: number; message: string }[] = [];

  /**
   * Record an error
   */
  recordError(category: string, error?: Error): void {
    const count = (this.errorCounts.get(category) || 0) + 1;
    this.errorCounts.set(category, count);

    if (error) {
      this.warnings.push({
        time: Date.now(),
        message: `[${category}] ${error.message}`,
      });

      // Keep only last 100 warnings
      if (this.warnings.length > 100) {
        this.warnings.shift();
      }
    }
  }

  /**
   * Check if health is degraded
   */
  isHealthy(errorThreshold: number = 10): boolean {
    for (const [category, count] of this.errorCounts.entries()) {
      if (count > errorThreshold) {
        console.warn(`⚠️  Health warning: ${category} error count (${count}) exceeds threshold`);
        return false;
      }
    }
    return true;
  }

  /**
   * Get health report
   */
  getReport(): Record<string, any> {
    const recentWarnings = this.warnings.filter(
      w => Date.now() - w.time < 3600000 // Last hour
    );

    return {
      errorCounts: Object.fromEntries(this.errorCounts),
      recentWarningsCount: recentWarnings.length,
      health: this.isHealthy() ? "healthy" : "degraded",
    };
  }

  reset(): void {
    this.errorCounts.clear();
    this.warnings = [];
  }
}
