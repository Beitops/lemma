import { describe, expect, it } from "vitest";
import { markdownToPlainText } from "./markdownToPlainText";

describe("markdownToPlainText", () => {
  it("turns common Markdown and TeX into a readable native label", () => {
    expect(markdownToPlainText(String.raw`**Route:** $\frac{\alpha + \beta}{\sqrt{n}}$ via [this note](https://example.com)`)).toBe(
      "Route: α + β/√(n) via this note",
    );
  });

  it("handles nested TeX groups and leaves no delimiter or command source behind", () => {
    const label = markdownToPlainText(String.raw`\[\frac{n(n+1)}{2}\] when \(n\in\mathbb{Z}_{>0}\)`);

    expect(label).toBe("n(n+1)/2 when n∈Z>0");
    expect(label).not.toMatch(/[\\${}]/);
  });

  it("keeps adjacent commands distinct when TeX formatting wrappers are removed", () => {
    expect(markdownToPlainText(String.raw`\mathbb R \to \mathcal{F}`)).toBe("R → F");
  });

  it("keeps Markdown content readable across headings, lists, code, and line breaks", () => {
    expect(markdownToPlainText("## Goal\n- Use `x^2`\n- then **finish**")).toBe("Goal Use x^2 then finish");
  });

  it("uses a useful fallback for blank content", () => {
    expect(markdownToPlainText("  \n  ")).toBe("Untitled");
    expect(markdownToPlainText("", "No label")).toBe("No label");
  });
});
