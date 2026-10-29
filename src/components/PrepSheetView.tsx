import React, { useState } from 'react';
import { AlertTriangle, Check, Copy, Download, ShieldAlert } from 'lucide-react';
import {
  countPrepSheetWords,
  formatPrepSheetPlainText,
  normalizeAssumptionsText,
} from '../types/prepSheet';
import type { PrepSheetApiResponse } from '../types/prepSheet';
import { downloadPrepSheetPdf } from '../utils/exportPrepSheetPdf';

interface PrepSheetViewProps {
  result: PrepSheetApiResponse | null;
  error: string | null;
  isGenerating: boolean;
  onAddMissingInfo: () => void;
  onGenerateQualitative: () => void;
  onRetry: () => void;
  onEditInput: () => void;
}

const SECTION_BLUEPRINT = [
  { num: '1', title: 'Header', desc: 'Case title, course name, and class date.' },
  {
    num: '2',
    title: 'Decision',
    desc: 'One sentence: who decides what specific choice, and by what deadline.',
  },
  {
    num: '3',
    title: 'Situation',
    desc: '3 to 4 lines leading with conclusions, framing the strategic inflection point.',
  },
  {
    num: '4',
    title: 'Key numbers',
    desc: '4 to 6 cited bullets with calculations and implications, plus one Assumptions line.',
  },
  {
    num: '5',
    title: 'Discussion questions',
    desc: '1 to 2 lines per answer, conclusion first, backed by case evidence.',
  },
  {
    num: '6',
    title: 'Frameworks',
    desc: '1 or 2 MBA frameworks: name, how it applies, and what it concludes.',
  },
  {
    num: '7',
    title: 'Cold-call ready',
    desc: 'Exactly 3 likely cold-call questions (recommendation, 2 reasons, 1 risk).',
  },
  {
    num: '8',
    title: 'My opening line',
    desc: 'One crisp sentence stating your actionable recommendation.',
  },
];

async function copyTextSafe(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to textarea selection in restricted iframe contexts
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export function PrepSheetView({
  result,
  error,
  isGenerating,
  onAddMissingInfo,
  onGenerateQualitative,
  onRetry,
  onEditInput,
}: PrepSheetViewProps) {
  const [copied, setCopied] = useState(false);

  // 1. Loading Skeleton State
  if (isGenerating) {
    return (
      <section
        aria-live="polite"
        aria-busy="true"
        className="border border-stone-200 bg-white p-6 sm:p-8"
      >
        <div className="mb-6 flex items-center justify-between border-b border-stone-200 pb-4">
          <div>
            <p className="text-sm font-semibold text-stone-900">
              Reading whole case & cross-checking exhibits...
            </p>
            <p className="mt-0.5 text-xs text-stone-500">
              Verifying deadlines, inline calculations, contradictions, and the 500-word cap
            </p>
          </div>
          <span className="font-mono text-xs text-stone-400 tabular-nums">
            ≤ 500 words
          </span>
        </div>

        <div className="space-y-5 animate-pulse">
          <div className="space-y-2">
            <div className="h-3 w-24 rounded bg-stone-200" />
            <div className="h-6 w-3/4 rounded bg-stone-200" />
            <div className="h-3.5 w-1/2 rounded bg-stone-100" />
          </div>
          <div className="h-px bg-stone-100" />
          <div className="space-y-2">
            <div className="h-3 w-20 rounded bg-stone-200" />
            <div className="h-4 w-full rounded bg-stone-100" />
          </div>
          <div className="h-px bg-stone-100" />
          <div className="space-y-2">
            <div className="h-3 w-28 rounded bg-stone-200" />
            <div className="h-3.5 w-full rounded bg-stone-100" />
            <div className="h-3.5 w-11/12 rounded bg-stone-100" />
            <div className="h-3.5 w-5/6 rounded bg-stone-100" />
          </div>
          <div className="h-px bg-stone-100" />
          <div className="space-y-2.5">
            <div className="h-3 w-28 rounded bg-stone-200" />
            <div className="h-3.5 w-full rounded bg-stone-100" />
            <div className="h-3.5 w-11/12 rounded bg-stone-100" />
            <div className="h-3.5 w-full rounded bg-stone-100" />
            <div className="h-3.5 w-4/5 rounded bg-stone-100" />
          </div>
        </div>
      </section>
    );
  }

  // 2. Request Error State
  if (error) {
    return (
      <section
        role="alert"
        className="border border-red-200 bg-white p-6 sm:p-8"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle
            className="mt-0.5 h-5 w-5 shrink-0 text-red-700"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <h2 className="font-serif text-lg font-semibold text-stone-900">
              Prep sheet request failed
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-stone-800">
              {error}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onRetry}
                className="rounded-md bg-blue-950 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-900 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Try Again
              </button>
              <button
                type="button"
                onClick={onEditInput}
                className="rounded-md border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-800 hover:bg-stone-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Review Case Input
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // 3. Declined State (Graded Assignment Refusal)
  if (result?.status === 'declined') {
    return (
      <section
        role="region"
        aria-label="Academic integrity notice"
        className="border border-stone-300 bg-white p-6 sm:p-8"
      >
        <div className="flex items-start gap-3.5">
          <ShieldAlert
            className="mt-0.5 h-5 w-5 shrink-0 text-red-700"
            aria-hidden="true"
          />
          <div>
            <h2 className="font-serif text-xl font-semibold text-stone-900">
              For Personal Class Prep Only
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-stone-700">
              {result.declineMessage ||
                'This app is for personal class prep only and declines requests to write graded assignments for submission.'}
            </p>
            <button
              type="button"
              onClick={onEditInput}
              className="mt-5 rounded-md border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-900 hover:bg-stone-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              Edit Case Input
            </button>
          </div>
        </div>
      </section>
    );
  }

  // 4. Missing Key Number or Exhibit Prompt (Instead of a Sheet)
  if (result?.status === 'missing_info') {
    return (
      <section
        role="region"
        aria-label="Missing case data prompt"
        className="border border-amber-300 bg-white p-6 sm:p-8"
      >
        <div className="flex items-start gap-3.5">
          <AlertTriangle
            className="mt-0.5 h-5 w-5 shrink-0 text-amber-700"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <h2 className="font-serif text-xl font-semibold text-stone-900">
              Missing Key Number or Exhibit
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-stone-800">
              {result.missingInfoNote}
            </p>
            <p className="mt-2 text-xs text-stone-500">
              Choose how to proceed — CasePrep never fills missing figures or exhibits with a guess.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onAddMissingInfo}
                className="rounded-md bg-blue-950 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-blue-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-950 focus-visible:ring-offset-2 whitespace-nowrap shrink-0 cursor-pointer"
              >
                I'll add it
              </button>
              <button
                type="button"
                onClick={onGenerateQualitative}
                className="rounded-md border border-stone-300 bg-white px-4 py-2.5 text-xs font-semibold text-stone-900 transition-colors hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Make a qualitative sheet (no numbers)
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // 5. Ready State: Render the One-Page 8-Section Prep Sheet
  if (result?.status === 'ready' && result.sheet) {
    const { sheet } = result;
    const plainText = formatPrepSheetPlainText(sheet);
    const totalWords = result.wordCount ?? countPrepSheetWords(sheet);
    const assumptionsNormalized = normalizeAssumptionsText(
      sheet.keyNumbers.assumptionsLine
    );

    const handleCopy = async () => {
      const ok = await copyTextSafe(plainText);
      if (ok) {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      }
    };

    return (
      <div id="prep-sheet-output">
        {/* Toolbar above the one-page sheet */}
        <div className="no-print mb-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs text-stone-600">
            <span className="font-medium text-stone-900">One-Page Prep Sheet</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {totalWords} / 500 words
            </span>
            {result.mode === 'qualitative' && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-amber-800">Qualitative (no numbers)</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => downloadPrepSheetPdf(sheet)}
              className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3.5 py-2 text-xs font-semibold text-stone-800 transition-colors hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Download PDF
            </button>

            <button
              type="button"
              onClick={() => void handleCopy()}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-950 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-950 focus-visible:ring-offset-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  Copy
                </>
              )}
            </button>
          </div>
        </div>

        {/* The One-Page Sheet — Strictly 8 Fixed Sections, Ending at My opening line */}
        <article
          aria-label="Generated case prep sheet"
          className="print-sheet divide-y divide-stone-200 border border-stone-200 bg-white px-6 py-6 sm:px-8 sm:py-7"
        >
          {/* (1) Header */}
          <div id="sec-header" className="pb-4">
            <p className="font-mono text-[11px] font-medium text-stone-500 tabular-nums">
              1. Header
            </p>
            <h1
              className="mt-1 font-serif text-2xl font-semibold tracking-tight text-stone-950"
              style={{ textWrap: 'balance' }}
            >
              {sheet.header.caseTitle}
            </h1>
            {(sheet.header.course?.trim() || sheet.header.date?.trim()) && (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-stone-600">
                {sheet.header.course?.trim() && (
                  <span>{sheet.header.course.trim()}</span>
                )}
                {sheet.header.course?.trim() && sheet.header.date?.trim() && (
                  <span aria-hidden="true">·</span>
                )}
                {sheet.header.date?.trim() && (
                  <span className="tabular-nums">{sheet.header.date.trim()}</span>
                )}
              </div>
            )}
          </div>

          {/* (2) Decision */}
          <div id="sec-decision" className="py-3.5">
            <h2 className="font-mono text-[11px] font-medium text-stone-500 tabular-nums">
              2. Decision
            </h2>
            <p className="mt-1 text-sm font-medium leading-snug text-stone-900 tabular-nums">
              {sheet.decision}
            </p>
          </div>

          {/* (3) Situation */}
          <div id="sec-situation" className="py-3.5">
            <h2 className="font-mono text-[11px] font-medium text-stone-500 tabular-nums">
              3. Situation
            </h2>
            <ul className="mt-1.5 space-y-1 text-sm leading-snug text-stone-800 tabular-nums">
              {sheet.situation.map((line, idx) => (
                <li key={idx} className="flex gap-2">
                  <span className="select-none text-stone-400" aria-hidden="true">
                    •
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* (4) Key numbers + single Assumptions: line */}
          <div id="sec-numbers" className="py-3.5">
            <h2 className="font-mono text-[11px] font-medium text-stone-500 tabular-nums">
              4. Key numbers
            </h2>
            <ul className="mt-1.5 space-y-1.5 text-sm leading-snug text-stone-800 tabular-nums">
              {sheet.keyNumbers.bullets.map((bullet, idx) => (
                <li key={idx} className="flex gap-2">
                  <span className="select-none text-stone-400" aria-hidden="true">
                    •
                  </span>
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2.5 text-xs leading-relaxed text-stone-700 tabular-nums">
              <span className="font-semibold text-stone-900">Assumptions:</span>{' '}
              {assumptionsNormalized}
            </p>
          </div>

          {/* (5) Discussion questions */}
          <div id="sec-questions" className="py-3.5">
            <h2 className="font-mono text-[11px] font-medium text-stone-500 tabular-nums">
              5. Discussion questions
            </h2>
            <div className="mt-1.5 space-y-2 text-sm leading-snug text-stone-800 tabular-nums">
              {sheet.discussionQuestions.map((item, idx) => (
                <div key={idx}>
                  <span className="font-semibold text-stone-900">
                    Q: {item.question}
                  </span>{' '}
                  <span className="text-stone-500" aria-hidden="true">
                    —
                  </span>{' '}
                  <span>{item.answer}</span>
                </div>
              ))}
            </div>
          </div>

          {/* (6) Frameworks */}
          <div id="sec-frameworks" className="py-3.5">
            <h2 className="font-mono text-[11px] font-medium text-stone-500 tabular-nums">
              6. Frameworks
            </h2>
            <ul className="mt-1.5 space-y-1.5 text-sm leading-snug text-stone-800 tabular-nums">
              {sheet.frameworks.map((fw, idx) => (
                <li key={idx}>
                  <span className="font-semibold text-stone-900">{fw.name}:</span>{' '}
                  <span>{fw.application}</span>{' '}
                  <span className="font-medium text-stone-900">
                    → {fw.conclusion}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* (7) Cold-call ready */}
          <div id="sec-coldcall" className="py-3.5">
            <h2 className="font-mono text-[11px] font-medium text-stone-500 tabular-nums">
              7. Cold-call ready
            </h2>
            <ol className="mt-1.5 space-y-2 text-sm leading-snug text-stone-800 tabular-nums">
              {sheet.coldCallReady.slice(0, 3).map((cc, idx) => (
                <li key={idx}>
                  <span className="font-mono text-xs font-medium text-stone-600">
                    {idx + 1})
                  </span>{' '}
                  <span className="font-semibold text-stone-900">
                    {cc.question}
                  </span>{' '}
                  <span className="text-stone-500" aria-hidden="true">
                    —
                  </span>{' '}
                  <span>{cc.answer}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* (8) My opening line — Final section, nothing rendered after */}
          <div id="sec-opening" className="pt-3.5">
            <h2 className="font-mono text-[11px] font-medium text-stone-500 tabular-nums">
              8. My opening line
            </h2>
            <p className="mt-1 font-serif text-base font-medium leading-snug text-stone-950">
              {sheet.myOpeningLine}
            </p>
          </div>
        </article>
      </div>
    );
  }

  // 6. Empty State: Architectural Blueprint of the 8-Section One-Page Sheet
  return (
    <section
      aria-label="Prep sheet template preview"
      className="border border-stone-200 bg-white p-6 sm:p-8"
    >
      <div className="border-b border-stone-200 pb-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-serif text-xl font-semibold tracking-tight text-stone-900">
            One-Page Sheet Structure
          </h2>
          <span className="font-mono text-xs text-stone-500 tabular-nums">
            8 fixed sections · ≤ 500 words
          </span>
        </div>
        <p className="mt-1 text-sm text-stone-600">
          Every line leads with the conclusion first, followed by inline calculations and page or exhibit citations.
        </p>
      </div>

      <ol className="mt-4 divide-y divide-stone-100">
        {SECTION_BLUEPRINT.map((sec) => (
          <li
            key={sec.num}
            className="flex items-baseline gap-3.5 py-2.5 text-sm"
          >
            <span className="w-4 shrink-0 font-mono text-xs font-medium text-stone-400 tabular-nums">
              {sec.num}.
            </span>
            <div className="min-w-0">
              <span className="font-semibold text-stone-900">{sec.title}</span>
              <span className="mx-1.5 text-stone-300" aria-hidden="true">
                —
              </span>
              <span className="text-stone-600">{sec.desc}</span>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-5 border-t border-stone-200 pt-4 text-xs leading-relaxed text-stone-500">
        Missing a key exhibit or number? CasePrep stops and asks whether you want to add it or generate a strictly qualitative sheet—never guessing or inventing figures.
      </div>
    </section>
  );
}
