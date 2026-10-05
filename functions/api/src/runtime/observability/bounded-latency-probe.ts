export async function runBoundedLatencyProbe(input: {
  readonly concurrency: number;
  readonly iterations: number;
  readonly probe: () => Promise<number>;
}): Promise<readonly number[]> {
  if (
    !Number.isSafeInteger(input.concurrency) ||
    input.concurrency < 1 ||
    !Number.isSafeInteger(input.iterations) ||
    input.iterations < input.concurrency
  )
    throw new Error("BOUNDED_LATENCY_PROBE_INVALID");
  const samples = Array<number>(input.iterations);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= input.iterations) return;
      const sample = await input.probe();
      if (!Number.isFinite(sample) || sample < 0)
        throw new Error("BOUNDED_LATENCY_SAMPLE_INVALID");
      samples[index] = sample;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(input.concurrency, input.iterations) }, worker),
  );
  return samples;
}
