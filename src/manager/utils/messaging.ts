// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function send(msg: Record<string, unknown>): Promise<any> {
  return browser.runtime.sendMessage(msg);
}
