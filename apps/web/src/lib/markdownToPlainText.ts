/**
 * Produces a compact, spoken-friendly label from Markdown that may contain
 * TeX. This is deliberately for places where rich content cannot be mounted
 * (native select options) or would be counterproductive (ARIA labels and
 * browser tooltips). Rendered content must continue through MarkdownMath.
 */

const TEX_COMMAND_LABELS: Record<string, string> = {
  alpha: "α",
  approx: "≈",
  beta: "β",
  cdot: "·",
  cdots: "…",
  circ: "∘",
  delta: "δ",
  div: "÷",
  ell: "ℓ",
  epsilon: "ε",
  eta: "η",
  exists: "∃",
  forall: "∀",
  gamma: "γ",
  gcd: "gcd",
  ge: "≥",
  geq: "≥",
  gets: "←",
  in: "∈",
  infty: "∞",
  infinity: "∞",
  int: "∫",
  lambda: "λ",
  ldots: "…",
  le: "≤",
  leq: "≤",
  log: "log",
  mapsto: "↦",
  mid: "|",
  mu: "μ",
  nabla: "∇",
  ne: "≠",
  neq: "≠",
  omega: "ω",
  partial: "∂",
  phi: "φ",
  pi: "π",
  pm: "±",
  prod: "Π",
  propto: "∝",
  quad: " ",
  qquad: " ",
  rho: "ρ",
  sigma: "σ",
  sim: "∼",
  subset: "⊂",
  subseteq: "⊆",
  sum: "Σ",
  superset: "⊃",
  supseteq: "⊇",
  tau: "τ",
  theta: "θ",
  times: "×",
  to: "→",
  varphi: "φ",
  varepsilon: "ε",
  varrho: "ρ",
  vartheta: "θ",
};

const TEX_GROUP_COMMANDS = [
  "bf",
  "cal",
  "emph",
  "mathbf",
  "mathbb",
  "mathcal",
  "mathfrak",
  "mathit",
  "mathrm",
  "mathsf",
  "mathtt",
  "operatorname",
  "overline",
  "text",
  "textrm",
  "texttt",
  "underline",
  "vec",
] as const;

const TEX_GROUP_COMMAND_PATTERN = TEX_GROUP_COMMANDS.join("|");
// Prevent a removed formatting wrapper from joining an adjacent TeX command
// (for example, `\\in\\mathbb{Z}` must not become the unknown `\\inZ`).
const TEX_COMMAND_BOUNDARY = "\u0000";

/**
 * Flatten Markdown and common TeX notation into text that is useful in a
 * native control or accessibility label. It intentionally favours a clear
 * approximation (for example `√(n)`) over exposing raw TeX commands.
 */
export function markdownToPlainText(markdown: string, fallback = "Untitled"): string {
  let text = markdown;

  // Markdown constructs whose destinations or delimiters add noise in a
  // spoken label. Keep their user-authored labels and code contents.
  text = text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/<\/?[A-Za-z][^>]*>/g, "")
    .replace(/^\s{0,3}(?:#{1,6}\s+|[-+*]\s+|\d+[.)]\s+|>\s?)/gm, "")
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, " ");

  // Work from the innermost groups outward so nested fractions and wrapped
  // expressions become legible before generic TeX flattening runs.
  for (let depth = 0; depth < 5; depth += 1) {
    text = text
      .replace(/\\(?:c?d?frac|tfrac)\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "$1/$2")
      .replace(/\\sqrt(?:\[([^\]]*)\])?\s*\{([^{}]*)\}/g, (_match, index: string | undefined, body: string) => (
        index ? `root ${index}(${body})` : `√(${body})`
      ))
      .replace(/\\binom\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "C($1, $2)")
      .replace(new RegExp(`\\\\(?:${TEX_GROUP_COMMAND_PATTERN})\\s*\\{([^{}]*)\\}`, "g"), `${TEX_COMMAND_BOUNDARY}$1${TEX_COMMAND_BOUNDARY}`);
  }

  // Formatting commands sometimes omit braces (for example `\\mathbb R`).
  // Preserve the meaningful token rather than reading out the command name.
  text = text.replace(new RegExp(`\\\\(?:${TEX_GROUP_COMMAND_PATTERN})\\s*([A-Za-z0-9])`, "g"), `${TEX_COMMAND_BOUNDARY}$1${TEX_COMMAND_BOUNDARY}`);

  return text
    .replaceAll("\\[", " ")
    .replaceAll("\\]", " ")
    .replaceAll("\\(", " ")
    .replaceAll("\\)", " ")
    .replace(/\\(?:left|right|bigl|bigr|Bigl|Bigr|big|Big)\b/g, "")
    .replace(/\\(?:,|;|:|!|\s|newline|\\\\)/g, " ")
    .replace(/\\begin\s*\{[^{}]*\}|\\end\s*\{[^{}]*\}|&/g, " ")
    .replace(/\\([A-Za-z]+)/g, (_match, command: string) => TEX_COMMAND_LABELS[command] ?? command)
    .replace(/\\(.)/g, "$1")
    .replace(/\$+/g, " ")
    .replace(/[{}]/g, "")
    .replace(/[*_~]/g, "")
    .replaceAll(TEX_COMMAND_BOUNDARY, "")
    .replace(/\s+/g, " ")
    .trim() || fallback;
}
