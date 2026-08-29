export function cx(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter(Boolean).join(" ");
}

export function formatRelativeTime(value: string): string {
  const timestamp = new Date(value).getTime();
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000));

  if (elapsedSeconds < 60) return "just now";
  if (elapsedSeconds < 3_600) return `${Math.floor(elapsedSeconds / 60)}m ago`;
  if (elapsedSeconds < 86_400) return `${Math.floor(elapsedSeconds / 3_600)}h ago`;
  if (elapsedSeconds < 604_800) return `${Math.floor(elapsedSeconds / 86_400)}d ago`;

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: new Date(value).getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(new Date(value));
}

export function initials(value: string): string {
  const localPart = value.split("@")[0] ?? value;
  return localPart.slice(0, 2).toUpperCase();
}

export function markdownPreview(value: string): string {
  return value
    .replace(/```[\s\S]*?```/gu, " code ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/[#>*_~`|]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}
