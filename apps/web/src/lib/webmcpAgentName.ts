/**
 * A presentation-only label for WebMCP mutations made from this browser tab.
 *
 * `sessionStorage` is deliberately used instead of localStorage: opening five
 * demo tabs can give each agent a distinct identity. Browsers may clone this
 * storage when a tab is duplicated, so the demo URLs intentionally override
 * it per tab. This value never participates in authentication or authorization;
 * it is only sent as normal agent provenance by WebMCP.
 */
export const DEFAULT_WEBMCP_AGENT_NAME = "ChatGPT WebMCP";
export const WEBMCP_AGENT_NAME_STORAGE_KEY = "lemma.webmcp.agent-name";
export const MAX_WEBMCP_AGENT_NAME_LENGTH = 48;

type AgentNameStorage = Pick<Storage, "getItem" | "setItem">;

const VALID_AGENT_NAME = /^[\p{L}\p{N}](?:[\p{L}\p{N} .,'()&/_-])*$/u;

/**
 * Keeps the label compact, readable in activity history, and safe to pass as
 * plain provenance. The server remains the authority for all authorization.
 */
export function sanitizeWebMcpAgentName(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;

  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (
    normalized.length === 0
    || Array.from(normalized).length > MAX_WEBMCP_AGENT_NAME_LENGTH
    || !VALID_AGENT_NAME.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

function readStoredAgentName(storage: AgentNameStorage | null | undefined): string | null {
  if (!storage) return null;

  try {
    return sanitizeWebMcpAgentName(storage.getItem(WEBMCP_AGENT_NAME_STORAGE_KEY));
  } catch {
    // Storage can be disabled by the browser. The default remains usable.
    return null;
  }
}

function persistAgentName(storage: AgentNameStorage | null | undefined, agentName: string): void {
  if (!storage) return;

  try {
    storage.setItem(WEBMCP_AGENT_NAME_STORAGE_KEY, agentName);
  } catch {
    // Persistence is a demo convenience, never a requirement to use WebMCP.
  }
}

/**
 * Resolves a tab's display alias. A valid URL override wins once and is then
 * retained for subsequent client-side route changes and reloads in that tab.
 */
export function resolveWebMcpAgentName(
  search: string,
  storage?: AgentNameStorage | null,
): string {
  const fromUrl = sanitizeWebMcpAgentName(new URLSearchParams(search).get("agent"));
  if (fromUrl) {
    persistAgentName(storage, fromUrl);
    return fromUrl;
  }

  return readStoredAgentName(storage) ?? DEFAULT_WEBMCP_AGENT_NAME;
}

function browserSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Reads the current URL only during application initialization. */
export function resolveCurrentTabWebMcpAgentName(): string {
  if (typeof window === "undefined") return DEFAULT_WEBMCP_AGENT_NAME;
  return resolveWebMcpAgentName(window.location.search, browserSessionStorage());
}
