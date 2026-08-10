const ENVIRONMENT_KEY = /^[A-Z][A-Z0-9_]*$/;

export function parseServiceEnvironment(content: string) {
  const environment: Record<string, string> = {};
  for (const [index, sourceLine] of content.split(/\r?\n/).entries()) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error(`本机服务配置第 ${index + 1} 行无效`);
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!ENVIRONMENT_KEY.test(key) || !value) {
      throw new Error(`本机服务配置第 ${index + 1} 行无效`);
    }
    if (environment[key] !== undefined) throw new Error(`本机服务配置重复：${key}`);
    environment[key] = value;
  }
  return environment;
}
