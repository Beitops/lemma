import { describe, expect, it } from "vitest";
import { normalizeMathMarkdown } from "./normalizeMathMarkdown";

describe("normalizeMathMarkdown", () => {
  it("converts the screenshot-style inline TeX while preserving its commands", () => {
    const markdown = String.raw`Let \(n\in\mathbb Z_{>0}\), and let \(S\subseteq\{1,2,\ldots,n\}\) be the set of selected integers, with \(|S|=n+1\).`;

    expect(normalizeMathMarkdown(markdown)).toBe(
      String.raw`Let $n\in\mathbb Z_{>0}$, and let $S\subseteq\{1,2,\ldots,n\}$ be the set of selected integers, with $|S|=n+1$.`,
    );
  });

  it("converts paired display delimiters into a remark-math display block", () => {
    const markdown = ["We need:", String.raw`\[`, String.raw`\sum_{k=1}^{n} k = \frac{n(n+1)}{2}`, String.raw`\]`, "Done."].join(
      "\n",
    );

    expect(normalizeMathMarkdown(markdown)).toBe(
      ["We need:", "$$", String.raw`\sum_{k=1}^{n} k = \frac{n(n+1)}{2}`, "$$", "Done."].join("\n"),
    );
  });

  it("turns a standalone one-line display expression into remark-math block syntax", () => {
    const markdown = String.raw`\[\frac{n(n+1)}{2}\]`;

    expect(normalizeMathMarkdown(markdown)).toBe(["$$", String.raw`\frac{n(n+1)}{2}`, "$$"].join("\n"));
  });

  it("expands an unambiguous one-line dollar display expression into its own block lines", () => {
    const markdown = String.raw`$$\sum_{k=1}^{n} k = \frac{n(n+1)}{2}$$`;

    expect(normalizeMathMarkdown(markdown)).toBe(
      ["$$", String.raw`\sum_{k=1}^{n} k = \frac{n(n+1)}{2}`, "$$"].join("\n"),
    );
  });

  it("recovers the exact malformed clipboard pattern without absorbing following inline math", () => {
    const markdown = String.raw`$x=m^2-n^2,\qquad y=2mn,\qquad z=m^2+n^2, $$where $m>n>0$, $\gcd(m,n)=1$.`;

    expect(normalizeMathMarkdown(markdown)).toBe(
      [
        "$$",
        String.raw`x=m^2-n^2,\qquad y=2mn,\qquad z=m^2+n^2,`,
        "$$",
        String.raw`where $m>n>0$, $\gcd(m,n)=1$.`,
      ].join("\n"),
    );
  });

  it("separates prose attached to a multi-line display closing delimiter", () => {
    const markdown = [
      "Classify every primitive triple as",
      String.raw`\[`,
      String.raw`x=m^2-n^2,\qquad y=2mn,\qquad z=m^2+n^2,`,
      String.raw`\]where \(m>n>0\) and \(\gcd(m,n)=1\).`,
    ].join("\n");

    expect(normalizeMathMarkdown(markdown)).toBe(
      [
        "Classify every primitive triple as",
        "$$",
        String.raw`x=m^2-n^2,\qquad y=2mn,\qquad z=m^2+n^2,`,
        "$$",
        String.raw`where $m>n>0$ and $\gcd(m,n)=1$.`,
      ].join("\n"),
    );
  });

  it("moves display TeX surrounded by prose onto valid display-math lines", () => {
    const markdown = String.raw`By the identity \[x^2 + y^2 = z^2\] the result follows.`;

    expect(normalizeMathMarkdown(markdown)).toBe(
      ["By the identity", "$$", String.raw`x^2 + y^2 = z^2`, "$$", "the result follows."].join("\n"),
    );
  });

  it("leaves canonical dollar-delimited math untouched", () => {
    const markdown = ["Inline $x^2$ remains unchanged.", "", "$$", String.raw`\int_0^1 x\,dx`, "$$"].join("\n");

    expect(normalizeMathMarkdown(markdown)).toBe(markdown);
  });

  it("preserves inline, fenced, and indented code plus escaped delimiters", () => {
    const markdown = [
      "Inline code: `\\(x^2\\)` and `\\[z^2\\]`; literal \\\\(x\\\\) stays literal; outside \\(y^2\\) renders.",
      "",
      "```tex",
      String.raw`\[x^2\]`,
      "```",
      "",
      String.raw`    \(indented_code\)`,
      "",
      String.raw`Outside \(z^2\).`,
    ].join("\n");

    expect(normalizeMathMarkdown(markdown)).toBe(
      [
        "Inline code: `\\(x^2\\)` and `\\[z^2\\]`; literal \\\\(x\\\\) stays literal; outside $y^2$ renders.",
        "",
        "```tex",
        String.raw`\[x^2\]`,
        "```",
        "",
        String.raw`    \(indented_code\)`,
        "",
        "Outside $z^2$.",
      ].join("\n"),
    );
  });

  it("leaves currency, escaped dollars, literal doubled dollars, and ambiguous display-like text unchanged", () => {
    const markdown = [
      "The ticket costs $12.50 and the escaped form \\$$x^2$$ is literal.",
      "",
      "$$100$$",
      "",
      "$$plain text$$",
      "",
      "`$$x^2$$`",
      "",
      "```tex",
      "$$x^2$$",
      "```",
      "",
      "    $$x^2$$",
    ].join("\n");

    expect(normalizeMathMarkdown(markdown)).toBe(markdown);
  });

  it("preserves Markdown container prefixes around display math", () => {
    const markdown = [String.raw`> \[`, String.raw`> \sum_{k=1}^{n} k`, String.raw`> \]`].join("\n");

    expect(normalizeMathMarkdown(markdown)).toBe(
      ["> $$", String.raw`> \sum_{k=1}^{n} k`, "> $$"].join("\n"),
    );
  });

  it("keeps one-line display math inside blockquotes and list items", () => {
    const blockQuote = String.raw`> \[\sum_{k=1}^{n} k\]`;
    const listItem = String.raw`- \[x^2 + y^2 = z^2\]`;

    expect(normalizeMathMarkdown(blockQuote)).toBe(
      ["> $$", String.raw`> \sum_{k=1}^{n} k`, "> $$"].join("\n"),
    );
    expect(normalizeMathMarkdown(listItem)).toBe(
      ["- $$", String.raw`  x^2 + y^2 = z^2`, "  $$"].join("\n"),
    );
  });

  it("is conservative for malformed delimiters and idempotent for valid input", () => {
    const malformed = String.raw`Keep an unmatched \(x^2 and \] exactly as written.`;
    const markdown = [
      String.raw`\(\nabla f = 0\)`,
      "",
      String.raw`\[x^2 + y^2 = z^2\]`,
      "",
      String.raw`$$\int_0^1 x\,dx$$`,
      "",
      String.raw`$x=m^2-n^2,\qquad y=2mn,\qquad z=m^2+n^2, $$where $m>n>0$, $\gcd(m,n)=1$.`,
      "",
      "`\\(code\\)`",
    ].join("\n");
    const normalized = normalizeMathMarkdown(markdown);

    expect(normalizeMathMarkdown(malformed)).toBe(malformed);
    expect(normalizeMathMarkdown(normalized)).toBe(normalized);
  });

  it("handles many unmatched opening delimiters without rescanning suffixes", () => {
    const malformed = String.raw`\(`.repeat(25_000);

    expect(normalizeMathMarkdown(malformed)).toBe(malformed);
  });
});
