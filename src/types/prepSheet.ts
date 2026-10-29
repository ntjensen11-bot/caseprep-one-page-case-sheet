export type PrepMode = 'standard' | 'qualitative';

export interface PrepSheetHeader {
  caseTitle: string;
  course: string;
  date: string;
}

export interface PrepSheetQuestionAnswer {
  question: string;
  answer: string;
}

export interface PrepSheetFramework {
  name: string;
  application: string;
  conclusion: string;
}

export interface PrepSheetData {
  header: PrepSheetHeader;
  decision: string;
  situation: string[];
  keyNumbers: {
    bullets: string[];
    assumptionsLine: string;
  };
  discussionQuestions: PrepSheetQuestionAnswer[];
  frameworks: PrepSheetFramework[];
  coldCallReady: PrepSheetQuestionAnswer[];
  myOpeningLine: string;
}

export interface PdfAttachmentPayload {
  fileName: string;
  mimeType: string;
  base64Data: string;
}

export interface PrepSheetRequestPayload {
  caseText?: string;
  pdfAttachment?: PdfAttachmentPayload | null;
  supplementalText?: string;
  supplementalPdf?: PdfAttachmentPayload | null;
  courseName?: string;
  classDate?: string;
  mode?: PrepMode;
}

export type PrepSheetResponseStatus = 'ready' | 'missing_info' | 'declined';

export interface PrepSheetApiResponse {
  status: PrepSheetResponseStatus;
  mode: PrepMode;
  missingInfoNote?: string;
  declineMessage?: string;
  sheet?: PrepSheetData;
  wordCount?: number;
}

export function normalizeAssumptionsText(raw: string): string {
  const trimmed = raw.trim();
  const stripped = trimmed.replace(/^assumptions\s*:\s*/i, '');
  return stripped.length > 0 ? stripped : 'None noted beyond explicit case figures.';
}

/**
 * Produces the canonical plain-text representation of the 8 fixed sections,
 * ending strictly at "My opening line" with zero extra sections.
 */
export function formatPrepSheetPlainText(sheet: PrepSheetData): string {
  const headerParts = [
    sheet.header.caseTitle.trim(),
    sheet.header.course?.trim(),
    sheet.header.date?.trim(),
  ].filter((part): part is string => Boolean(part && part.length > 0));
  const headerLine = `1. Header\n${headerParts.join(' · ')}`;

  const decisionBlock = `2. Decision\n${sheet.decision.trim()}`;

  const situationLines = sheet.situation
    .map((line) => `- ${line.trim()}`)
    .join('\n');
  const situationBlock = `3. Situation\n${situationLines}`;

  const numberBullets = sheet.keyNumbers.bullets
    .map((bullet) => `- ${bullet.trim()}`)
    .join('\n');
  const assumptions = `Assumptions: ${normalizeAssumptionsText(sheet.keyNumbers.assumptionsLine)}`;
  const keyNumbersBlock = `4. Key numbers\n${numberBullets}\n${assumptions}`;

  const discussionItems = sheet.discussionQuestions
    .map((item) => `- Q: ${item.question.trim()} — ${item.answer.trim()}`)
    .join('\n');
  const discussionBlock = `5. Discussion questions\n${discussionItems}`;

  const frameworkItems = sheet.frameworks
    .map(
      (fw) =>
        `- ${fw.name.trim()}: ${fw.application.trim()} → ${fw.conclusion.trim()}`
    )
    .join('\n');
  const frameworksBlock = `6. Frameworks\n${frameworkItems}`;

  const coldCallItems = sheet.coldCallReady
    .slice(0, 3)
    .map((cc, idx) => `${idx + 1}) ${cc.question.trim()} — ${cc.answer.trim()}`)
    .join('\n');
  const coldCallBlock = `7. Cold-call ready\n${coldCallItems}`;

  const openingBlock = `8. My opening line\n${sheet.myOpeningLine.trim()}`;

  return [
    headerLine,
    decisionBlock,
    situationBlock,
    keyNumbersBlock,
    discussionBlock,
    frameworksBlock,
    coldCallBlock,
    openingBlock,
  ].join('\n\n');
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

export function countPrepSheetWords(sheet: PrepSheetData): number {
  return countWords(formatPrepSheetPlainText(sheet));
}
