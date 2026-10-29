import React, { useRef, useState } from 'react';
import { FileText, Upload, X, Plus } from 'lucide-react';
import type { PdfAttachmentPayload } from '../types/prepSheet';
import { countWords } from '../types/prepSheet';

export type InputTab = 'pdf' | 'text';

interface CaseInputPanelProps {
  activeTab: InputTab;
  onTabChange: (tab: InputTab) => void;
  courseName: string;
  onCourseNameChange: (val: string) => void;
  classDate: string;
  onClassDateChange: (val: string) => void;
  caseText: string;
  onCaseTextChange: (val: string) => void;
  pdfAttachment: PdfAttachmentPayload | null;
  onPdfAttachmentChange: (file: PdfAttachmentPayload | null) => void;
  pdfByteSize: number | null;
  onPdfByteSizeChange: (bytes: number | null) => void;
  showSupplemental: boolean;
  onToggleSupplemental: (show: boolean) => void;
  supplementalText: string;
  onSupplementalTextChange: (val: string) => void;
  supplementalPdf: PdfAttachmentPayload | null;
  onSupplementalPdfChange: (file: PdfAttachmentPayload | null) => void;
  missingReminderNote: string | null;
  isGenerating: boolean;
  onGenerate: () => void;
  onTrySample: () => void;
  caseTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  supplementalTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

function formatFileSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readPdfAsBase64(file: File): Promise<PdfAttachmentPayload> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIndex = result.indexOf(',');
      const base64Data = commaIndex >= 0 ? result.slice(commaIndex + 1) : result;
      if (!base64Data) {
        reject(new Error('Could not read PDF file contents.'));
        return;
      }
      resolve({
        fileName: file.name,
        mimeType: file.type || 'application/pdf',
        base64Data,
      });
    };
    reader.onerror = () => reject(new Error('Failed to read selected PDF file.'));
    reader.readAsDataURL(file);
  });
}

export function CaseInputPanel({
  activeTab,
  onTabChange,
  courseName,
  onCourseNameChange,
  classDate,
  onClassDateChange,
  caseText,
  onCaseTextChange,
  pdfAttachment,
  onPdfAttachmentChange,
  pdfByteSize,
  onPdfByteSizeChange,
  showSupplemental,
  onToggleSupplemental,
  supplementalText,
  onSupplementalTextChange,
  supplementalPdf,
  onSupplementalPdfChange,
  missingReminderNote,
  isGenerating,
  onGenerate,
  onTrySample,
  caseTextareaRef,
  supplementalTextareaRef,
}: CaseInputPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const suppFileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const hasAnyCaseMaterial =
    Boolean(pdfAttachment?.base64Data) ||
    Boolean(caseText.trim()) ||
    Boolean(supplementalPdf?.base64Data) ||
    Boolean(supplementalText.trim());

  const canSubmit = !isGenerating && hasAnyCaseMaterial;

  const handlePrimaryPdfSelect = async (file: File | undefined) => {
    if (!file) return;
    setFileError(null);

    const isPdf =
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      setFileError('Please select a PDF file (.pdf), or switch to Paste Text.');
      return;
    }
    if (file.size > 28 * 1024 * 1024) {
      setFileError('PDF must be 28 MB or smaller for in-memory processing.');
      return;
    }

    try {
      const payload = await readPdfAsBase64(file);
      onPdfAttachmentChange(payload);
      onPdfByteSizeChange(file.size);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : 'Unable to read PDF.');
    }
  };

  const handleSupplementalPdfSelect = async (file: File | undefined) => {
    if (!file) return;
    setFileError(null);
    const isPdf =
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      setFileError('Supplemental upload must be a PDF file (.pdf).');
      return;
    }
    try {
      const payload = await readPdfAsBase64(file);
      onSupplementalPdfChange(payload);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : 'Unable to read supplemental PDF.');
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files?.[0];
    void handlePrimaryPdfSelect(droppedFile);
  };

  const pastedWords = countWords(caseText);

  return (
    <section
      aria-label="Case input"
      className="no-print border border-stone-200 bg-white p-6"
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-serif text-xl font-semibold tracking-tight text-stone-900">
            Case Material
          </h2>
          <p className="mt-1 text-sm text-stone-600">
            Upload one case PDF or paste the text to build a cold-call-ready one-page sheet.
          </p>
        </div>
        <button
          type="button"
          onClick={onTrySample}
          disabled={isGenerating}
          className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-800 transition-colors hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-950/20 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
        >
          Try a sample
        </button>
      </div>

      {/* Optional Course & Class Date */}
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="course-name"
            className="mb-1.5 block text-xs font-medium text-stone-700"
          >
            Course name <span className="font-normal text-stone-400">· Optional</span>
          </label>
          <input
            id="course-name"
            type="text"
            value={courseName}
            onChange={(e) => onCourseNameChange(e.target.value)}
            placeholder="e.g., Competitive Strategy"
            disabled={isGenerating}
            className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-blue-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-950/20 disabled:opacity-60"
          />
        </div>

        <div>
          <label
            htmlFor="class-date"
            className="mb-1.5 block text-xs font-medium text-stone-700"
          >
            Class date <span className="font-normal text-stone-400">· Optional</span>
          </label>
          <input
            id="class-date"
            type="text"
            value={classDate}
            onChange={(e) => onClassDateChange(e.target.value)}
            placeholder="e.g., Nov 3, 2026"
            disabled={isGenerating}
            className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-blue-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-950/20 disabled:opacity-60"
          />
        </div>
      </div>

      {/* Segmented Input Mode Control */}
      <div
        role="tablist"
        aria-label="Case input method"
        className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-stone-100 p-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'pdf'}
          onClick={() => {
            setFileError(null);
            onTabChange('pdf');
          }}
          disabled={isGenerating}
          className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'pdf'
              ? 'bg-white text-stone-900 shadow-xs'
              : 'text-stone-600 hover:text-stone-900'
          }`}
        >
          <Upload className="h-3.5 w-3.5" aria-hidden="true" />
          Upload PDF
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'text'}
          onClick={() => {
            setFileError(null);
            onTabChange('text');
          }}
          disabled={isGenerating}
          className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'text'
              ? 'bg-white text-stone-900 shadow-xs'
              : 'text-stone-600 hover:text-stone-900'
          }`}
        >
          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
          Paste Text
        </button>
      </div>

      {/* Active Input Area */}
      {activeTab === 'pdf' ? (
        <div className="mb-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={(e) => {
              void handlePrimaryPdfSelect(e.target.files?.[0]);
              e.target.value = '';
            }}
          />

          {!pdfAttachment ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => !isGenerating && fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && !isGenerating) {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              className={`flex min-h-[210px] cursor-pointer flex-col items-center justify-center rounded-md border border-dashed px-6 py-8 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-950/30 ${
                isDragging
                  ? 'border-blue-950 bg-stone-50'
                  : 'border-stone-300 bg-[#FAF9F6]/60 hover:border-stone-400 hover:bg-stone-50'
              }`}
            >
              <Upload className="mb-3 h-6 w-6 text-stone-500" aria-hidden="true" />
              <p className="text-sm font-medium text-stone-900">
                Drop case PDF here, or click to browse
              </p>
              <p className="mt-1 text-xs text-stone-500">
                Reads narrative text, financial exhibits, tables, and footnotes directly
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 rounded-md border border-stone-200 bg-[#FAF9F6] px-4 py-3.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-stone-900">
                  {pdfAttachment.fileName}
                </p>
                <p className="mt-0.5 font-mono text-xs text-stone-500 tabular-nums">
                  PDF loaded in memory
                  {pdfByteSize ? ` · ${formatFileSize(pdfByteSize)}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isGenerating}
                  className="px-2.5 py-1.5 text-xs font-medium text-stone-700 hover:text-stone-950 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onPdfAttachmentChange(null);
                    onPdfByteSizeChange(null);
                  }}
                  disabled={isGenerating}
                  aria-label="Remove uploaded PDF"
                  className="rounded-md p-1.5 text-stone-500 hover:bg-stone-200/70 hover:text-stone-900 cursor-pointer"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}

          {caseText.trim() && (
            <p className="mt-2 text-xs text-stone-500">
              Note: Pasted text ({pastedWords.toLocaleString()} words) is also present and will be read alongside the PDF.{' '}
              <button
                type="button"
                onClick={() => onCaseTextChange('')}
                className="underline hover:text-stone-900 cursor-pointer"
              >
                Clear pasted text
              </button>
            </p>
          )}
        </div>
      ) : (
        <div className="mb-4">
          <div className="mb-1.5 flex items-center justify-between text-xs text-stone-500">
            <label htmlFor="case-text-input" className="font-medium text-stone-700">
              Case text and exhibits
            </label>
            <span className="font-mono tabular-nums">
              {pastedWords.toLocaleString()} words
            </span>
          </div>
          <textarea
            ref={caseTextareaRef}
            id="case-text-input"
            rows={10}
            value={caseText}
            onChange={(e) => onCaseTextChange(e.target.value)}
            disabled={isGenerating}
            placeholder="Paste the full business case text, including all tables and exhibits..."
            className="w-full resize-y rounded-md border border-stone-300 bg-white p-3.5 text-sm leading-relaxed text-stone-900 placeholder:text-stone-400 focus:border-blue-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-950/20 disabled:opacity-60"
          />
          {pdfAttachment && (
            <p className="mt-2 text-xs text-stone-500">
              Attached PDF ({pdfAttachment.fileName}) will also be included.{' '}
              <button
                type="button"
                onClick={() => {
                  onPdfAttachmentChange(null);
                  onPdfByteSizeChange(null);
                }}
                className="underline hover:text-stone-900 cursor-pointer"
              >
                Remove PDF
              </button>
            </p>
          )}
        </div>
      )}

      {fileError && (
        <p role="alert" className="mb-4 text-xs font-medium text-red-700">
          {fileError}
        </p>
      )}

      {/* Supplemental Missing Exhibit / Numbers Section */}
      {!showSupplemental ? (
        <div className="mb-5">
          <button
            type="button"
            onClick={() => onToggleSupplemental(true)}
            disabled={isGenerating}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-600 hover:text-stone-900 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add separate exhibit or missing table
          </button>
        </div>
      ) : (
        <div className="mb-5 rounded-md border border-stone-200 bg-[#FAF9F6] p-3.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <label
              htmlFor="supplemental-text"
              className="text-xs font-semibold text-stone-800"
            >
              Additional exhibit or missing numbers
            </label>
            <button
              type="button"
              onClick={() => {
                onSupplementalTextChange('');
                onSupplementalPdfChange(null);
                onToggleSupplemental(false);
              }}
              className="text-xs text-stone-500 hover:text-stone-900 whitespace-nowrap shrink-0 cursor-pointer"
            >
              Remove
            </button>
          </div>

          {missingReminderNote && (
            <p className="mb-2.5 text-xs leading-relaxed text-amber-800">
              Requested detail: {missingReminderNote}
            </p>
          )}

          <textarea
            ref={supplementalTextareaRef}
            id="supplemental-text"
            rows={4}
            value={supplementalText}
            onChange={(e) => onSupplementalTextChange(e.target.value)}
            disabled={isGenerating}
            placeholder="Paste the missing exhibit, table figures, or financial schedule here..."
            className="w-full resize-y rounded-md border border-stone-300 bg-white p-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-blue-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-950/20"
          />

          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
            <input
              ref={suppFileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={(e) => {
                void handleSupplementalPdfSelect(e.target.files?.[0]);
                e.target.value = '';
              }}
            />

            {!supplementalPdf ? (
              <button
                type="button"
                onClick={() => suppFileInputRef.current?.click()}
                disabled={isGenerating}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-700 underline decoration-stone-300 underline-offset-2 hover:text-stone-950 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Upload className="h-3 w-3" aria-hidden="true" />
                Or attach exhibit PDF
              </button>
            ) : (
              <div className="flex items-center gap-2 text-xs text-stone-700">
                <span className="max-w-[200px] truncate font-medium">
                  {supplementalPdf.fileName}
                </span>
                <button
                  type="button"
                  onClick={() => onSupplementalPdfChange(null)}
                  className="text-stone-500 underline hover:text-stone-900 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Clear PDF
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Primary Action Button */}
      <button
        type="button"
        onClick={onGenerate}
        disabled={!canSubmit}
        className="w-full rounded-md bg-blue-950 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-stone-300 disabled:text-stone-500 whitespace-nowrap shrink-0 cursor-pointer"
      >
        {isGenerating ? 'Reading case & building sheet...' : 'Build One-Page Prep Sheet'}
      </button>

      <p className="mt-3 text-xs leading-relaxed text-stone-500">
        Personal class prep only · Cases are read transiently in memory and never stored, logged, or connected to external accounts.
      </p>
    </section>
  );
}
