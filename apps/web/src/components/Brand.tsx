import { Asterisk } from "lucide-react";

interface BrandProps {
  compact?: boolean;
}

export function Brand({ compact = false }: BrandProps) {
  return (
    <div className="brand" aria-label="Lemma">
      <span className="brand__mark" aria-hidden="true">
        <Asterisk strokeWidth={2.6} />
      </span>
      {!compact && <span className="brand__name">lemma</span>}
    </div>
  );
}
