/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRef, useState } from 'react';
import { CaseInputPanel } from './components/CaseInputPanel';
import type { InputTab } from './components/CaseInputPanel';
import { PrepSheetView } from './components/PrepSheetView';
import type {
  PdfAttachmentPayload,
  PrepMode,
  PrepSheetApiResponse,
  PrepSheetRequestPayload,
} from './types/prepSheet';
import {
  SAMPLE_CASE_TEXT,
  SAMPLE_CLASS_DATE,
  SAMPLE_COURSE_NAME,
} from './data/sampleCase';

type InfoDrawer = 'rules' | 'privacy' | null;

export default function App() {
  const [activeTab, setActiveTab] = useState<InputTab>('pdf');
  const [courseName, setCourseName] = useState('');
  const [classDate, setClassDate] = useState('');
  const [caseText, setCaseText] = useState('');
  const [pdfAttachment, setPdfAttachment] = useState<PdfAttachmentPayload | null>(null);
  const [pdfByteSize, setPdfByteSize] = useState<number | null>(null);

  const [showSupplemental, setShowSupplemental] = useState(false);
  const [supplementalText, setSupplementalText] = useState('');
  const [supplementalPdf, setSupplementalPdf] = useState<PdfAttachmentPayload | null>(null);
  const [missingReminderNote, setMissingReminderNote] = useState<string | null>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [lastMode, setLastMode] = useState<PrepMode>('standard');
  const [result, setResult] = useState<PrepSheetApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openDrawer, setOpenDrawer] = useState<InfoDrawer>(null);

  const inputSectionRef = useRef<HTMLDivElement | null>(null);
  const outputSectionRef = useRef<HTMLDivElement | null>(null);
  const caseTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const supplementalTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const runGeneration = async (mode: PrepMode) => {
    setLastMode(mode);
    setIsGenerating(true);
    setError(null);

    const payload: PrepSheetRequestPayload = {
      caseText: caseText.trim() || undefined,
      pdfAttachment,
      supplementalText: supplementalText.trim() || undefined,
      supplementalPdf,
      courseName: courseName.trim() || undefined,
      classDate: classDate.trim() || undefined,
      mode,
    };

    try {
      const response = await fetch('/api/prep-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const rawText = await response.text();
      let data:
        | (PrepSheetApiResponse & {
            error?: string;
            code?: string;
            details?: string;
          })
        | null = null;
      try {
        data = JSON.parse(rawText) as PrepSheetApiResponse & {
          error?: string;
          code?: string;
          details?: string;
        };
      } catch (parseErr) {
        console.error('[CasePrep] Non-JSON response from /api/prep-sheet:', {
          status: response.status,
          statusText: response.statusText,
          parseError: parseErr,
          bodyPreview: rawText.slice(0, 300),
        });
        throw new Error(
          `Server returned HTTP ${response.status} (${response.statusText || 'unexpected response'}) instead of JSON.`
        );
      }

      if (!response.ok || !data) {
        console.error('[CasePrep] Prep sheet API error:', {
          httpStatus: response.status,
          code: data?.code,
          error: data?.error,
          details: data?.details,
        });
        throw new Error(
          data?.error || `Gemini request failed (HTTP ${response.status}).`
        );
      }

      setResult(data);
      if (data.status === 'ready') {
        setMissingReminderNote(null);
      }
    } catch (err) {
      console.error('[CasePrep] Generation failed:', err);
      setError(
        err instanceof Error
          ? err.message
          : 'Network or server error while calling Gemini.'
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleResetCase = () => {
    setCaseText('');
    setPdfAttachment(null);
    setPdfByteSize(null);
    setShowSupplemental(false);
    setSupplementalText('');
    setSupplementalPdf(null);
    setMissingReminderNote(null);
    setResult(null);
    setError(null);
  };

  const handleTrySample = () => {
    setActiveTab('text');
    setCourseName(SAMPLE_COURSE_NAME);
    setClassDate(SAMPLE_CLASS_DATE);
    setCaseText(SAMPLE_CASE_TEXT);
    setPdfAttachment(null);
    setPdfByteSize(null);
    setShowSupplemental(false);
    setSupplementalText('');
    setSupplementalPdf(null);
    setMissingReminderNote(null);
    setResult(null);
    setError(null);
  };

  const handleAddMissingInfo = () => {
    const note = result?.missingInfoNote || null;
    setMissingReminderNote(note);
    setResult(null);

    if (activeTab === 'text' && !pdfAttachment) {
      inputSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.setTimeout(() => {
        caseTextareaRef.current?.focus();
      }, 120);
      return;
    }

    setShowSupplemental(true);
    inputSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => {
      supplementalTextareaRef.current?.focus();
    }, 120);
  };

  const handleEditInput = () => {
    inputSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (activeTab === 'text') {
      window.setTimeout(() => caseTextareaRef.current?.focus(), 100);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-stone-900">
      {/* 3-Zone Top Bar Contract */}
      <header className="no-print border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-[1380px] items-center justify-between gap-8 px-6 py-3.5">
          {/* Zone 1: Single-line Brand Wordmark */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="font-serif text-xl font-semibold tracking-tight text-stone-950 whitespace-nowrap shrink-0"
          >
            CasePrep
          </a>

          {/* Zone 2: 4 concise single-line workspace links */}
          <nav
            aria-label="Workspace navigation"
            className="hidden md:flex items-center gap-6 text-sm font-medium text-stone-600"
          >
            <button
              type="button"
              onClick={() =>
                inputSectionRef.current?.scrollIntoView({ behavior: 'smooth' })
              }
              className="hover:text-stone-950 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Case Input
            </button>
            <button
              type="button"
              onClick={() =>
                outputSectionRef.current?.scrollIntoView({ behavior: 'smooth' })
              }
              className="hover:text-stone-950 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Prep Sheet
            </button>
            <button
              type="button"
              onClick={() =>
                setOpenDrawer((prev) => (prev === 'rules' ? null : 'rules'))
              }
              aria-expanded={openDrawer === 'rules'}
              className={`hover:text-stone-950 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                openDrawer === 'rules' ? 'text-stone-950 underline' : ''
              }`}
            >
              Method Rules
            </button>
            <button
              type="button"
              onClick={() =>
                setOpenDrawer((prev) => (prev === 'privacy' ? null : 'privacy'))
              }
              aria-expanded={openDrawer === 'privacy'}
              className={`hover:text-stone-950 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                openDrawer === 'privacy' ? 'text-stone-950 underline' : ''
              }`}
            >
              Zero-Retention
            </button>
          </nav>

          {/* Zone 3: 1 primary workspace utility action */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={handleResetCase}
              disabled={isGenerating}
              className="rounded-md border border-stone-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-stone-800 transition-colors hover:bg-stone-50 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              Clear Case
            </button>
          </div>
        </div>

        {/* Collapsible Reference Strip when toggled from header */}
        {openDrawer === 'rules' && (
          <div className="border-t border-stone-200 bg-[#FAF9F6] px-6 py-4">
            <div className="mx-auto flex max-w-[1380px] items-start justify-between gap-6 text-xs leading-relaxed text-stone-700">
              <p>
                <span className="font-semibold text-stone-900">Prep Discipline:</span>{' '}
                Reads the full case first · Leads every line with the conclusion · Cites every figure to page or exhibit with inline calculations · Collects all assumptions, data gaps, and conflicting figures in one <span className="font-mono">Assumptions:</span> line under Key numbers · Ends strictly at <span className="font-mono">8. My opening line</span> in ≤ 500 words.
              </p>
              <button
                type="button"
                onClick={() => setOpenDrawer(null)}
                className="font-semibold text-stone-600 hover:text-stone-950 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {openDrawer === 'privacy' && (
          <div className="border-t border-stone-200 bg-[#FAF9F6] px-6 py-4">
            <div className="mx-auto flex max-w-[1380px] items-start justify-between gap-6 text-xs leading-relaxed text-stone-700">
              <p>
                <span className="font-semibold text-stone-900">Privacy & Academic Boundaries:</span>{' '}
                No connection to Gmail, Drive, Calendar, or the web · Uploaded PDFs and pasted cases are never saved to disk, databases, or logs · Never uses post-case outcomes · Strictly for personal class discussion prep (declines graded submission write-ups).
              </p>
              <button
                type="button"
                onClick={() => setOpenDrawer(null)}
                className="font-semibold text-stone-600 hover:text-stone-950 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Main One-Screen Split Workspace */}
      <main className="mx-auto max-w-[1380px] px-4 py-6 sm:px-6 lg:py-8">
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12 lg:gap-8">
          <div ref={inputSectionRef} className="lg:col-span-5">
            <CaseInputPanel
              activeTab={activeTab}
              onTabChange={setActiveTab}
              courseName={courseName}
              onCourseNameChange={setCourseName}
              classDate={classDate}
              onClassDateChange={setClassDate}
              caseText={caseText}
              onCaseTextChange={setCaseText}
              pdfAttachment={pdfAttachment}
              onPdfAttachmentChange={setPdfAttachment}
              pdfByteSize={pdfByteSize}
              onPdfByteSizeChange={setPdfByteSize}
              showSupplemental={showSupplemental}
              onToggleSupplemental={setShowSupplemental}
              supplementalText={supplementalText}
              onSupplementalTextChange={setSupplementalText}
              supplementalPdf={supplementalPdf}
              onSupplementalPdfChange={setSupplementalPdf}
              missingReminderNote={missingReminderNote}
              isGenerating={isGenerating}
              onGenerate={() => void runGeneration('standard')}
              onTrySample={handleTrySample}
              caseTextareaRef={caseTextareaRef}
              supplementalTextareaRef={supplementalTextareaRef}
            />
          </div>

          <div ref={outputSectionRef} className="lg:col-span-7">
            <PrepSheetView
              result={result}
              error={error}
              isGenerating={isGenerating}
              onAddMissingInfo={handleAddMissingInfo}
              onGenerateQualitative={() => void runGeneration('qualitative')}
              onRetry={() => void runGeneration(lastMode)}
              onEditInput={handleEditInput}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

