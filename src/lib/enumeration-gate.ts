/**
 * 同時実行数を制限するゲート。
 *
 * 上限は設定パネルからいつでも変えられるので、待ち行列は保ったまま
 * 上限だけを差し替えられるようにしてある。上限を上げれば待っていたぶんが
 * すぐ動き出し、下げれば実行中が終わったところから絞られる。
 */
export class EnumerationGate {
  private limit = 1;
  private active = 0;
  private waiting: (() => void)[] = [];

  /** いま走っている数 */
  get activeCount(): number {
    return this.active;
  }

  /** 順番待ちの数 */
  get waitingCount(): number {
    return this.waiting.length;
  }

  setLimit(limit: number): void {
    const next = Math.max(1, Math.floor(limit));
    if (next === this.limit) return;
    this.limit = next;
    this.drain();
  }

  acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  release(): void {
    this.active -= 1;
    this.drain();
  }

  /** 空きがあるぶんだけ待ち行列を進める */
  private drain(): void {
    while (this.active < this.limit && this.waiting.length > 0) {
      this.active += 1;
      this.waiting.shift()!();
    }
  }
}

/** 上限つきで並列に処理する。上限に達しているぶんは順番待ちになる。 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index]);
    }
  };

  const workers = Math.min(Math.max(1, Math.floor(limit)), items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}
