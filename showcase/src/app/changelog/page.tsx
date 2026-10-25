import { Section } from "@/components/site/ui";

export default function ChangelogPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-10">
      <Section kicker="Placeholder" title="Changelog">
        <p className="text-base leading-relaxed text-ink-dim">
          Changelog content is coming. This stub keeps the site building; the
          content team will replace it with releases 0.1.0 and 0.1.1.
        </p>
      </Section>
    </div>
  );
}
