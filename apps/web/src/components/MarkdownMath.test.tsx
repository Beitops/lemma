import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownMath, MathText } from "./MarkdownMath";

describe("MarkdownMath", () => {
  it("renders Markdown and TeX through the safe KaTeX pipeline", () => {
    const { container } = render(
      <MarkdownMath markdown={"**Result.** The value is $x^2 + 1$."} />,
    );

    expect(screen.getByText("Result.")).toBeInTheDocument();
    expect(container.querySelector(".katex")).not.toBeNull();
  });

  it("renders agent-authored LaTeX delimiters used by existing steps", () => {
    const markdown = String.raw`Let \(n\in\mathbb Z_{>0}\), and let \(S\subseteq\{1,2,\ldots,2n\}\) satisfy \(|S|=n+1\). Then \(x\mid y\) or \(y\mid x\).`;
    const { container } = render(<MarkdownMath markdown={markdown} />);

    expect(container.querySelectorAll(".katex")).toHaveLength(5);
  });

  it("renders backslash-delimited display math as a readable block", () => {
    const markdown = [String.raw`\[`, String.raw`\sum_{k=1}^{n} k = \frac{n(n+1)}{2}`, String.raw`\]`].join("\n");
    const { container } = render(<MarkdownMath markdown={markdown} />);

    expect(container.querySelector(".katex-display")).not.toBeNull();
  });

  it("keeps LaTeX examples in code literal while rendering surrounding math", () => {
    const markdown = "Keep `\\(x^2\\)` literal, but render \\(y^2\\).";
    const { container } = render(<MarkdownMath markdown={markdown} />);

    expect(screen.getByText(String.raw`\(x^2\)`, { selector: "code" })).toBeInTheDocument();
    expect(container.querySelectorAll(".katex")).toHaveLength(1);
  });

  it("does not execute user-authored raw HTML", () => {
    const { container } = render(
      <MarkdownMath markdown={'<script>window.__unsafe = true</script><img src="x" onerror="window.__unsafe = true">'} />,
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("localizes invalid TeX to a readable inline fallback", () => {
    const { container } = render(<MarkdownMath markdown={"Invalid: $\\frac{1$"} />);
    const fallback = container.querySelector(".katex-error");

    expect(fallback).not.toBeNull();
    expect(fallback).toHaveTextContent("\\frac{1");
  });

  it("repairs the mixed clipboard delimiters from the reported Pythagorean objective", () => {
    const markdown = [
      String.raw`Classify every primitive triple, after swapping \(x\) and \(y\), as`,
      String.raw`\[`,
      String.raw`x=m^2-n^2,\qquad y=2mn,\qquad z=m^2+n^2,`,
      String.raw`\]where \(m>n>0\) and \(\gcd(m,n)=1\).`,
    ].join("\n");
    const { container } = render(<MarkdownMath markdown={markdown} />);

    expect(container.querySelector(".katex-error")).toBeNull();
    expect(container.querySelector(".katex-display")).not.toBeNull();
    expect(container.querySelectorAll(".katex")).toHaveLength(5);
    expect(container).toHaveTextContent("where");
  });

  it("renders a non-interactive inline preview safely inside a button", () => {
    const { container } = render(
      <button type="button">
        <MathText markdown={String.raw`## Result: \(x^2 + y^2\) [proof](https://example.com)`} />
      </button>,
    );

    const preview = container.querySelector("button .math-text");
    expect(preview?.tagName).toBe("SPAN");
    expect(preview?.querySelector(".katex")).not.toBeNull();
    expect(preview?.querySelector("a")).toBeNull();
    expect(preview?.querySelector("h2, p, ul, ol, table, input")).toBeNull();
  });

  it("keeps display math in the inline preview instead of producing a block container", () => {
    const { container } = render(<MathText markdown={"$$\nx^2 + y^2 = z^2\n$$"} />);
    const displayMath = container.querySelector(".math-text .katex-display");

    expect(displayMath?.tagName).toBe("SPAN");
    expect(displayMath?.parentElement?.tagName).toBe("SPAN");
  });
});
