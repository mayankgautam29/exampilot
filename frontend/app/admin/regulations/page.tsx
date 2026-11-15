"use client";

import { RegulationsQA } from "@/components/regulations-qa";
import { PageHeader } from "@/components/ui-kit";

export default function RegulationsPage() {
  return (
    <div>
      <PageHeader eyebrow="Govern" title="Regulations Q&A" description="Answers come only from the approved regulations and always cite the rule. If the regulations do not cover a question, the answer is a refusal. Nothing is invented." />
      <div className="max-w-3xl">
        <RegulationsQA />
      </div>
    </div>
  );
}
