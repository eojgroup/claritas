import type { HeadlineTranslationPresentation } from "../lib/api";
import { translationStatusLabel } from "../lib/headlineTranslation";

export default function HeadlineTranslation({ value, showOriginal = true, showSummaryNotice = false }: {
  value: HeadlineTranslationPresentation;
  showOriginal?: boolean;
  showSummaryNotice?: boolean;
}) {
  const label = translationStatusLabel(value);
  if (!label) return null;
  const translated = value.translation_status === "translated";
  const notice = value.translation_notice || value.translation_availability?.reason || undefined;
  return <div className="headline-translation">
    <span title={notice}>{label}</span>
    {showSummaryNotice && value.original_summary && value.summary_translation_status === "pending"
      && <span>Source excerpt in original language</span>}
    {showOriginal && translated && value.original_title && <details>
      <summary>Original headline</summary>
      <p lang={value.language_code || undefined} dir="auto">{value.original_title}</p>
      {value.translation?.provider && <small>Automatically translated from publisher text · {value.translation.provider}{value.translation.title_generated_at ? ` · ${new Date(value.translation.title_generated_at).toLocaleDateString()}` : ""}</small>}
    </details>}
  </div>;
}
