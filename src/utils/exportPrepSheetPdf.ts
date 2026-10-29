import { jsPDF } from 'jspdf';
import { normalizeAssumptionsText } from '../types/prepSheet.ts';
import type { PrepSheetData } from '../types/prepSheet.ts';

/**
 * Normalizes Unicode punctuation/math symbols to WinAnsi-safe ASCII/Latin-1
 * so standard PDF Type-1 fonts (Helvetica, Times, Courier) never render garbled glyphs.
 */
export function toPdfSafeText(input: string): string {
  return (input || '')
    .replace(/\u2192/g, '->')
    .replace(/\u2190/g, '<-')
    .replace(/\u2194/g, '<->')
    .replace(/\u2264/g, '<=')
    .replace(/\u2265/g, '>=')
    .replace(/\u2248/g, '~')
    .replace(/\u2260/g, '!=')
    .replace(/\u00D7/g, 'x')
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\u2013\u2014]/g, ' - ')
    .replace(/[\u2212\u2010\u2011\u2012]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00B7/g, '|')
    .replace(/[\u00A0\u202F\u2009]/g, ' ')
    .replace(/[^\x20-\x7E\xA1-\xFF]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Builds a clean PDF filename named after the case title.
 */
export function buildPrepSheetPdfFilename(caseTitle: string): string {
  const cleaned = (caseTitle || '')
    .replace(/[:/\\|]+/g, ' - ')
    .replace(/[*?"<>#%{}^~[\]`]+/g, '')
    .replace(/[\x00-\x1F\x7F]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^(?:\s*-\s*)+|(?:\s*-\s*)+$/g, '')
    .trim()
    .slice(0, 110)
    .trim();

  const base = cleaned.length > 0 ? cleaned : 'Case Prep Sheet';
  return `${base}.pdf`;
}

const LETTER_WIDTH_PT = 612;
const LETTER_HEIGHT_PT = 792;
const MARGIN_X = 40;
const MARGIN_TOP = 34;
const MARGIN_BOTTOM = 34;
const CONTENT_WIDTH = LETTER_WIDTH_PT - MARGIN_X * 2;
const MAX_CONTENT_HEIGHT = LETTER_HEIGHT_PT - MARGIN_TOP - MARGIN_BOTTOM;

function renderPrepSheetToDoc(
  doc: jsPDF,
  sheet: PrepSheetData,
  scale: number,
  dryRun: boolean
): number {
  let y = MARGIN_TOP;

  const kickerSize = 7.5 * scale;
  const titleSize = 15.5 * scale;
  const subMetaSize = 8.5 * scale;
  const bodySize = 9.1 * scale;
  const smallNoteSize = 8.3 * scale;
  const openingSize = 9.8 * scale;

  const bodyLineHeight = bodySize * 1.32;
  const smallLineHeight = smallNoteSize * 1.3;
  const titleLineHeight = titleSize * 1.2;
  const openingLineHeight = openingSize * 1.32;

  const sectionGapTop = 6.5 * scale;
  const sectionGapBottom = 6.5 * scale;
  const bulletIndent = 10 * scale;

  const drawDivider = () => {
    y += sectionGapBottom;
    if (!dryRun) {
      doc.setDrawColor(225, 222, 218);
      doc.setLineWidth(0.5);
      doc.line(MARGIN_X, y, MARGIN_X + CONTENT_WIDTH, y);
    }
    y += sectionGapTop;
  };

  const drawSectionKicker = (label: string) => {
    doc.setFont('courier', 'normal');
    doc.setFontSize(kickerSize);
    const h = kickerSize * 1.15;
    if (!dryRun) {
      doc.setTextColor(115, 110, 104);
      doc.text(label, MARGIN_X, y + kickerSize * 0.85);
    }
    y += h + 2.5 * scale;
  };

  const drawWrappedParagraph = (
    text: string,
    opts: {
      font?: 'helvetica' | 'times' | 'courier';
      style?: 'normal' | 'bold' | 'italic';
      size: number;
      lineHeight: number;
      indent?: number;
      bullet?: string;
      color?: [number, number, number];
    }
  ) => {
    const safe = toPdfSafeText(text);
    if (!safe) return;

    const font = opts.font ?? 'helvetica';
    const style = opts.style ?? 'normal';
    const indent = opts.indent ?? 0;
    const color = opts.color ?? [28, 25, 23];

    doc.setFont(font, style);
    doc.setFontSize(opts.size);

    const lines = doc.splitTextToSize(safe, CONTENT_WIDTH - indent) as string[];
    if (!dryRun) {
      doc.setTextColor(color[0], color[1], color[2]);
      if (opts.bullet) {
        doc.text(opts.bullet, MARGIN_X, y + opts.size * 0.85);
      }
      lines.forEach((line, i) => {
        doc.text(line, MARGIN_X + indent, y + i * opts.lineHeight + opts.size * 0.85);
      });
    }
    y += lines.length * opts.lineHeight;
  };

  // (1) Header
  drawSectionKicker('1. Header');
  drawWrappedParagraph(sheet.header.caseTitle || 'Untitled Business Case', {
    font: 'times',
    style: 'bold',
    size: titleSize,
    lineHeight: titleLineHeight,
    color: [12, 10, 9],
  });
  const subHeaderParts = [
    toPdfSafeText(sheet.header.course || ''),
    toPdfSafeText(sheet.header.date || ''),
  ].filter(Boolean);
  if (subHeaderParts.length > 0) {
    y += 2 * scale;
    drawWrappedParagraph(subHeaderParts.join(' | '), {
      font: 'helvetica',
      style: 'normal',
      size: subMetaSize,
      lineHeight: subMetaSize * 1.25,
      color: [87, 83, 78],
    });
  }

  drawDivider();

  // (2) Decision
  drawSectionKicker('2. Decision');
  drawWrappedParagraph(sheet.decision, {
    font: 'helvetica',
    style: 'bold',
    size: bodySize,
    lineHeight: bodyLineHeight,
    color: [20, 18, 16],
  });

  drawDivider();

  // (3) Situation
  drawSectionKicker('3. Situation');
  sheet.situation.forEach((line, idx) => {
    if (idx > 0) y += 1.8 * scale;
    drawWrappedParagraph(line, {
      size: bodySize,
      lineHeight: bodyLineHeight,
      indent: bulletIndent,
      bullet: '-',
    });
  });

  drawDivider();

  // (4) Key numbers + single Assumptions: line
  drawSectionKicker('4. Key numbers');
  sheet.keyNumbers.bullets.forEach((bullet, idx) => {
    if (idx > 0) y += 2 * scale;
    drawWrappedParagraph(bullet, {
      size: bodySize,
      lineHeight: bodyLineHeight,
      indent: bulletIndent,
      bullet: '-',
    });
  });
  y += 3.5 * scale;
  const assumptions = normalizeAssumptionsText(sheet.keyNumbers.assumptionsLine);
  drawWrappedParagraph(`Assumptions: ${assumptions}`, {
    size: smallNoteSize,
    lineHeight: smallLineHeight,
    color: [68, 64, 60],
  });

  drawDivider();

  // (5) Discussion questions
  drawSectionKicker('5. Discussion questions');
  sheet.discussionQuestions.forEach((dq, idx) => {
    if (idx > 0) y += 2.5 * scale;
    drawWrappedParagraph(`Q: ${dq.question} - ${dq.answer}`, {
      size: bodySize,
      lineHeight: bodyLineHeight,
    });
  });

  drawDivider();

  // (6) Frameworks
  drawSectionKicker('6. Frameworks');
  sheet.frameworks.forEach((fw, idx) => {
    if (idx > 0) y += 2 * scale;
    drawWrappedParagraph(`${fw.name}: ${fw.application} -> ${fw.conclusion}`, {
      size: bodySize,
      lineHeight: bodyLineHeight,
      indent: bulletIndent,
      bullet: '-',
    });
  });

  drawDivider();

  // (7) Cold-call ready
  drawSectionKicker('7. Cold-call ready');
  sheet.coldCallReady.slice(0, 3).forEach((cc, idx) => {
    if (idx > 0) y += 2.5 * scale;
    drawWrappedParagraph(`${cc.question} - ${cc.answer}`, {
      size: bodySize,
      lineHeight: bodyLineHeight,
      indent: 14 * scale,
      bullet: `${idx + 1})`,
    });
  });

  drawDivider();

  // (8) My opening line (Final section — nothing rendered after)
  drawSectionKicker('8. My opening line');
  drawWrappedParagraph(sheet.myOpeningLine, {
    font: 'times',
    style: 'bold',
    size: openingSize,
    lineHeight: openingLineHeight,
    color: [12, 10, 9],
  });

  return y - MARGIN_TOP;
}

/**
 * Generates a 1-page Letter-size (8.5" x 11") jsPDF document containing
 * strictly the 8-section finished prep sheet, automatically scaling typography
 * if necessary so it never spills onto a second page.
 */
export function createPrepSheetPdfDocument(sheet: PrepSheetData): jsPDF {
  const measureDoc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'letter',
  });

  let chosenScale = 1.0;
  for (let s = 1.0; s >= 0.58; s -= 0.03) {
    const heightNeeded = renderPrepSheetToDoc(measureDoc, sheet, s, true);
    if (heightNeeded <= MAX_CONTENT_HEIGHT) {
      chosenScale = s;
      break;
    }
    chosenScale = s;
  }

  const finalDoc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'letter',
  });

  finalDoc.setProperties({
    title: toPdfSafeText(sheet.header.caseTitle || 'Case Prep Sheet'),
    subject: 'One-Page MBA Case Prep Sheet',
  });

  renderPrepSheetToDoc(finalDoc, sheet, chosenScale, false);
  return finalDoc;
}

export function downloadPrepSheetPdf(sheet: PrepSheetData): void {
  const doc = createPrepSheetPdfDocument(sheet);
  const fileName = buildPrepSheetPdfFilename(sheet.header.caseTitle);
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1500);
}
