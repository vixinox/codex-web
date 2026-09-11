export async function startGuestRuntime(
  runtime: { ensureRuntime: () => Promise<unknown> },
  start: () => Promise<unknown>,
) {
  await runtime.ensureRuntime()
  return start()
}
