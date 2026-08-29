import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { normalizeMathMarkdown } from "../lib/normalizeMathMarkdown";

interface MarkdownMathProps {
  className?: string;
  compact?: boolean;
  markdown: string;
}

const components: Components = {
  a: ({ children, href }) => (
    <a className="nodrag nopan" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
};

/**
 * Markdown previews are frequently rendered inside buttons (for example, a
 * strategy or workspace card). Keep their output strictly phrasing content:
 * no block elements and no interactive descendants such as links or task
 * checkboxes. This lets the preview retain mathematical notation without
 * creating invalid HTML or competing click targets.
 */
const inlineComponents: Components = {
  a: ({ children }) => <span className="math-text__link">{children}</span>,
  blockquote: ({ children }) => <span className="math-text__block">{children} </span>,
  br: () => <span aria-hidden="true"> </span>,
  h1: ({ children }) => <span className="math-text__block">{children} </span>,
  h2: ({ children }) => <span className="math-text__block">{children} </span>,
  h3: ({ children }) => <span className="math-text__block">{children} </span>,
  h4: ({ children }) => <span className="math-text__block">{children} </span>,
  h5: ({ children }) => <span className="math-text__block">{children} </span>,
  h6: ({ children }) => <span className="math-text__block">{children} </span>,
  hr: () => <span aria-hidden="true"> </span>,
  img: ({ alt }) => <span>{alt}</span>,
  input: ({ checked }) => <span aria-label={checked ? "Completed" : "Not completed"}>{checked ? "☑" : "☐"}</span>,
  li: ({ children }) => <span className="math-text__item">• {children} </span>,
  ol: ({ children }) => <span className="math-text__block">{children}</span>,
  p: ({ children }) => <span className="math-text__block">{children} </span>,
  pre: ({ children }) => <span className="math-text__block">{children} </span>,
  table: ({ children }) => <span className="math-text__block">{children}</span>,
  tbody: ({ children }) => <span>{children}</span>,
  td: ({ children }) => <span>{children} </span>,
  tfoot: ({ children }) => <span>{children}</span>,
  th: ({ children }) => <span>{children} </span>,
  thead: ({ children }) => <span>{children}</span>,
  tr: ({ children }) => <span className="math-text__block">{children}</span>,
  ul: ({ children }) => <span className="math-text__block">{children}</span>,
};

const mathPlugins = [remarkGfm, remarkMath];

type KatexPluginOptions = NonNullable<Parameters<typeof rehypeKatex>[0]> & {
  throwOnError: false;
};

const katexPlugin: [typeof rehypeKatex, KatexPluginOptions] = [
  rehypeKatex,
  {
    strict: "warn",
    throwOnError: false,
    trust: false,
  },
];

export function MarkdownMath({
  className,
  compact = false,
  markdown,
}: MarkdownMathProps) {
  const normalizedMarkdown = normalizeMathMarkdown(markdown);

  return (
    <div className={["markdown", compact && "markdown--compact", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        components={components}
        remarkPlugins={mathPlugins}
        rehypePlugins={[katexPlugin]}
      >
        {normalizedMarkdown}
      </ReactMarkdown>
    </div>
  );
}

interface MathTextProps {
  className?: string;
  markdown: string;
}

/**
 * Safe, non-interactive Markdown + TeX text for dense previews, titles, and
 * tags. It intentionally flattens block Markdown and links to spans so it can
 * be embedded in interactive controls without invalid nested content.
 */
export function MathText({ className, markdown }: MathTextProps) {
  const normalizedMarkdown = normalizeMathMarkdown(markdown);

  return (
    <span className={["math-text", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        components={inlineComponents}
        rehypePlugins={[katexPlugin]}
        remarkPlugins={mathPlugins}
        skipHtml
      >
        {normalizedMarkdown}
      </ReactMarkdown>
    </span>
  );
}
