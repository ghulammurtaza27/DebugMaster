export class RateLimiter {
  private windowMs: number;
  private maxRequests: number;
  private requests: Map<string, number[]>;

  constructor(windowMs: number = 60000, maxRequests: number = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.requests = new Map();
  }

  isRateLimited(key: string): boolean {
    const now = Date.now();
    const timestamps = this.requests.get(key) || [];
    
    // Remove old timestamps
    const validTimestamps = timestamps.filter(
      timestamp => now - timestamp < this.windowMs
    );
    
    if (validTimestamps.length >= this.maxRequests) {
      return true;
    }
    
    validTimestamps.push(now);
    this.requests.set(key, validTimestamps);
    return false;
  }

  async waitForCapacity(key: string): Promise<void> {
    while (this.isRateLimited(key)) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

export const rateLimiter = new RateLimiter();
