import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_WEBMCP_AGENT_NAME,
  MAX_WEBMCP_AGENT_NAME_LENGTH,
  WEBMCP_AGENT_NAME_STORAGE_KEY,
  resolveWebMcpAgentName,
  sanitizeWebMcpAgentName,
} from "./webmcpAgentName";

describe("WebMCP per-tab agent names", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("uses the neutral default when the tab has no alias", () => {
    expect(resolveWebMcpAgentName("", window.sessionStorage))
      .toBe(DEFAULT_WEBMCP_AGENT_NAME);
  });

  it("uses a valid URL alias and persists it for later route changes in the same tab", () => {
    expect(resolveWebMcpAgentName("?agent=Geometry%20Agent%202", window.sessionStorage))
      .toBe("Geometry Agent 2");
    expect(window.sessionStorage.getItem(WEBMCP_AGENT_NAME_STORAGE_KEY))
      .toBe("Geometry Agent 2");

    expect(resolveWebMcpAgentName("", window.sessionStorage)).toBe("Geometry Agent 2");
  });

  it("ignores malformed aliases without replacing an existing tab alias", () => {
    window.sessionStorage.setItem(WEBMCP_AGENT_NAME_STORAGE_KEY, "Algebra Agent 1");

    expect(resolveWebMcpAgentName("?agent=%3Cscript%3Ealert(1)%3C%2Fscript%3E", window.sessionStorage))
      .toBe("Algebra Agent 1");
    expect(sanitizeWebMcpAgentName("Name\nWith\tControls")).toBe("Name With Controls");
  });

  it("ignores oversized aliases and falls back safely", () => {
    const oversized = "a".repeat(MAX_WEBMCP_AGENT_NAME_LENGTH + 1);

    expect(resolveWebMcpAgentName(`?agent=${oversized}`, window.sessionStorage))
      .toBe(DEFAULT_WEBMCP_AGENT_NAME);
  });
});
