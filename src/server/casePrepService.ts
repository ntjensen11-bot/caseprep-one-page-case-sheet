import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type { GenerateContentParameters, GenerateContentResponse } from '@google/genai';
import {
  countPrepSheetWords,
  formatPrepSheetPlainText,
  normalizeAssumptionsText,
} from '../types/prepSheet.ts';
import type {
  PrepMode,
  PrepSheetApiResponse,
  PrepSheetData,
  PrepSheetRequestPayload,
} from '../types/prepSheet.ts';

// Primary model: gemini-3.8-flash; fallback to gemini-3.1-flash-lite ONLY when primary is unavailable
const MODEL_CANDIDATES = [
  { model: 'gemini-3.8-flash', maxAttempts: 1, timeoutMs: 28000 },
  { model: 'gemini-3.1-flash-lite', maxAttempts: 2, timeoutMs: 28000 },
] as const;

export class CasePrepError extends Error {
  statusCode: number;
  code: string;
  userMessage: string;

  constructor(opts: {
    message: string;
    userMessage: string;
    statusCode?: number;
    code?: string;
  }) {
    super(opts.message);
    this.name = 'CasePrepError';
    this.userMessage = opts.userMessage;
    this.statusCode = opts.statusCode ?? 500;
    this.code = opts.code ?? 'GENERATION_ERROR';
  }
}

export function sanitizeSecretFromText(input: string): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.length < 6) return input;
  return input.split(key).join('[REDACTED_KEY]');
}

function extractUpstreamReason(err: unknown): {
  status?: number;
  apiStatus?: string;
  apiMessage: string;
  errName?: string;
} {
  const status = typeof (err as { status?: unknown })?.status === 'number'
    ? ((err as { status: number }).status)
    : undefined;
  const errName = (err as { name?: string })?.name;
  const rawMsg = sanitizeSecretFromText(
    err instanceof Error ? err.message : String(err ?? 'Unknown error')
  );

  try {
    const jsonStart = rawMsg.indexOf('{');
    if (jsonStart >= 0) {
      const parsed = JSON.parse(rawMsg.slice(jsonStart)) as {
        error?: { code?: number; message?: string; status?: string };
      };
      if (parsed?.error?.message) {
        return {
          status: status ?? parsed.error.code,
          apiStatus: parsed.error.status,
          apiMessage: sanitizeSecretFromText(parsed.error.message),
          errName,
        };
      }
    }
  } catch {
    // Use rawMsg directly if not JSON
  }

  return { status, apiMessage: rawMsg, errName };
}

function isTransientCapacityOrRateError(err: unknown): boolean {
  const { status, apiStatus, apiMessage, errName } = extractUpstreamReason(err);
  if (status === 503 || status === 502 || status === 504 || status === 429 || status === 500) {
    return true;
  }
  if (errName === 'TimeoutError' || errName === 'AbortError') {
    return true;
  }
  const upper = `${apiStatus ?? ''} ${apiMessage}`.toUpperCase();
  return (
    upper.includes('UNAVAILABLE') ||
    upper.includes('HIGH DEMAND') ||
    upper.includes('OVERLOADED') ||
    upper.includes('RESOURCE_EXHAUSTED') ||
    upper.includes('DEADLINE_EXCEEDED') ||
    upper.includes('ABORTED') ||
    upper.includes('TIMED OUT') ||
    upper.includes('TIMEOUT') ||
    upper.includes('FETCH FAILED')
  );
}

function toCasePrepError(err: unknown, context: string): CasePrepError {
  if (err instanceof CasePrepError) return err;

  const { status, apiStatus, apiMessage } = extractUpstreamReason(err);
  const upper = `${apiStatus ?? ''} ${apiMessage}`.toUpperCase();

  if (apiMessage === 'GEMINI_API_KEY_MISSING') {
    return new CasePrepError({
      message: `${context}: GEMINI_API_KEY environment variable is not set.`,
      userMessage:
        'Gemini API key is not configured. Check the Settings > Secrets panel.',
      statusCode: 403,
      code: 'API_KEY_MISSING',
    });
  }

  if (
    status === 401 ||
    status === 403 ||
    upper.includes('API_KEY_INVALID') ||
    upper.includes('PERMISSION_DENIED')
  ) {
    return new CasePrepError({
      message: `${context}: Authentication/permission error (${status ?? 403}): ${apiMessage}`,
      userMessage:
        'Gemini rejected the API key or lacks permission. Verify your key in Settings > Secrets.',
      statusCode: 403,
      code: 'AUTH_ERROR',
    });
  }

  if (status === 503 || upper.includes('UNAVAILABLE') || upper.includes('HIGH DEMAND')) {
    return new CasePrepError({
      message: `${context}: Model unavailable (${status ?? 503}): ${apiMessage}`,
      userMessage:
        'The Gemini model is temporarily overloaded due to high demand (503). Please wait a few seconds and try again.',
      statusCode: 503,
      code: 'MODEL_OVERLOADED',
    });
  }

  if (status === 429 || upper.includes('RESOURCE_EXHAUSTED')) {
    return new CasePrepError({
      message: `${context}: Quota or rate limit exceeded (429): ${apiMessage}`,
      userMessage:
        'Gemini API rate limit or quota was reached (429). Wait a moment and try again, or check quota in Settings > Secrets.',
      statusCode: 429,
      code: 'RATE_LIMITED',
    });
  }

  if (status === 404 || upper.includes('NOT_FOUND')) {
    return new CasePrepError({
      message: `${context}: Model not found (404): ${apiMessage}`,
      userMessage: `Gemini reported that the requested model is unavailable (404): ${apiMessage}`,
      statusCode: 502,
      code: 'MODEL_NOT_FOUND',
    });
  }

  if (status === 400 || upper.includes('INVALID_ARGUMENT')) {
    return new CasePrepError({
      message: `${context}: Invalid request to Gemini (400): ${apiMessage}`,
      userMessage: `Gemini rejected the request (400): ${apiMessage}`,
      statusCode: 400,
      code: 'INVALID_GEMINI_REQUEST',
    });
  }

  return new CasePrepError({
    message: `${context}: ${apiMessage}`,
    userMessage: `Gemini request failed: ${apiMessage}`,
    statusCode: status && status >= 400 && status < 600 ? status : 502,
    code: apiStatus || 'GEMINI_CALL_FAILED',
  });
}

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY_MISSING');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateWithFallback(
  ai: GoogleGenAI,
  params: Omit<GenerateContentParameters, 'model'>,
  label: string,
  preferModel?: string
): Promise<{ response: GenerateContentResponse; modelUsed: string }> {
  let lastError: unknown = null;
  const orderedCandidates = preferModel
    ? [
        ...MODEL_CANDIDATES.filter((c) => c.model === preferModel),
        ...MODEL_CANDIDATES.filter((c) => c.model !== preferModel),
      ]
    : [...MODEL_CANDIDATES];

  for (let i = 0; i < orderedCandidates.length; i++) {
    const { model, maxAttempts, timeoutMs } = orderedCandidates[i];
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await ai.models.generateContent({
          ...params,
          model,
          config: {
            ...params.config,
            abortSignal: AbortSignal.timeout(timeoutMs),
          },
        });
        console.log(`[CasePrep] ${label} succeeded using model="${model}"`);
        return { response, modelUsed: model };
      } catch (err: unknown) {
        lastError = err;
        const { status, apiStatus, apiMessage, errName } = extractUpstreamReason(err);
        const nextModel = orderedCandidates[i + 1]?.model;
        console.error(
          `[CasePrep] ${label} failed on model="${model}" (attempt ${attempt}/${maxAttempts}, status=${status ?? 'n/a'}, code=${apiStatus ?? errName ?? 'n/a'}): ${apiMessage}${
            attempt === maxAttempts && nextModel
              ? ` -> falling back to "${nextModel}"`
              : ''
          }`
        );

        if (!isTransientCapacityOrRateError(err)) {
          if (status === 404) {
            break;
          }
          throw toCasePrepError(err, `${label} (${model})`);
        }

        if (attempt < maxAttempts) {
          await delay(600 * attempt);
        }
      }
    }
  }

  throw toCasePrepError(
    lastError,
    `${label} (tried models: ${MODEL_CANDIDATES.map((c) => c.model).join(', ')})`
  );
}

export function parseModelJson<T>(rawText: string, context: string): T {
  let cleaned = rawText.trim();

  if (cleaned.startsWith('```')) {
    cleaned = cleaned
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
  }

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as T;
      } catch (innerErr) {
        const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
        console.error(`[CasePrep] JSON parse error in ${context}: ${msg}`);
        throw new CasePrepError({
          message: `JSON parse failed in ${context}: ${msg}`,
          userMessage:
            'Gemini returned malformed JSON while formatting the prep sheet. Please click Try Again.',
          statusCode: 502,
          code: 'JSON_PARSE_ERROR',
        });
      }
    }

    console.error(`[CasePrep] Non-JSON output received in ${context} (length=${cleaned.length})`);
    throw new CasePrepError({
      message: `Non-JSON response in ${context} (length=${cleaned.length})`,
      userMessage:
        'Gemini returned an unreadable response format. Please click Try Again.',
      statusCode: 502,
      code: 'NON_JSON_RESPONSE',
    });
  }
}

const SHEET_PROPERTIES = {
  header: {
    type: Type.OBJECT,
    properties: {
      caseTitle: {
        type: Type.STRING,
        description: 'Official title of the business case.',
      },
      course: {
        type: Type.STRING,
        description:
          'Exact course name entered by the student, or empty string "" if blank. NEVER guess or invent a course name.',
      },
      date: {
        type: Type.STRING,
        description:
          'Exact class date entered by the student, or empty string "" if blank. NEVER guess or invent a date.',
      },
    },
    required: ['caseTitle', 'course', 'date'],
  },
  decision: {
    type: Type.STRING,
    description:
      'Section 2: Exactly ONE sentence stating who decides what specific action/choice, and by what exact deadline/date.',
  },
  situation: {
    type: Type.ARRAY,
    description:
      'Section 3: 3 to 4 concise lines, each leading with the conclusion first followed by case evidence.',
    items: { type: Type.STRING },
  },
  keyNumbers: {
    type: Type.OBJECT,
    description:
      'Section 4: 4 to 6 conclusion-first bullets with page/exhibit citations and inline calculations, plus ONE Assumptions line.',
    properties: {
      bullets: {
        type: Type.ARRAY,
        description:
          '4 to 6 bullets (or qualitative structural notes in qualitative mode). Lead with what the number implies, then show the figure, inline calculation, and page/exhibit reference.',
        items: { type: Type.STRING },
      },
      assumptionsLine: {
        type: Type.STRING,
        description:
          'Single concise text line capturing EVERY assumption, missing data gap, and case quirk (including conflicting numbers across pages/exhibits). Do not include the "Assumptions:" label prefix.',
      },
    },
    required: ['bullets', 'assumptionsLine'],
  },
  discussionQuestions: {
    type: Type.ARRAY,
    description:
      'Section 5: 2 to 3 key discussion questions with answers of 1 to 2 lines each, conclusion first, backed by cited evidence.',
    items: {
      type: Type.OBJECT,
      properties: {
        question: { type: Type.STRING },
        answer: {
          type: Type.STRING,
          description:
            '1 to 2 lines, leading with the conclusion first, followed by cited case evidence and math.',
        },
      },
      required: ['question', 'answer'],
    },
  },
  frameworks: {
    type: Type.ARRAY,
    description:
      'Section 6: 1 or 2 applicable MBA frameworks, written as framework name, how it applies to this case, and what it concludes.',
    items: {
      type: Type.OBJECT,
      properties: {
        name: {
          type: Type.STRING,
          description:
            "MBA framework name (e.g., Porter's Five Forces, CAGE Distance, STP & 4Ps, Entry Modes, Unit Economics / LTV-CAC, Valuation Multiples & Debt Covenant Analysis).",
        },
        application: {
          type: Type.STRING,
          description: 'How the framework applies to the specific facts of this case.',
        },
        conclusion: {
          type: Type.STRING,
          description: 'What strategic or financial conclusion the framework yields.',
        },
      },
      required: ['name', 'application', 'conclusion'],
    },
  },
  coldCallReady: {
    type: Type.ARRAY,
    description:
      'Section 7: STRICTLY 3 likely cold-call questions with short answers. Each answer MUST include: clear recommendation, 2 evidence-backed reasons, and 1 concrete risk.',
    items: {
      type: Type.OBJECT,
      properties: {
        question: { type: Type.STRING },
        answer: {
          type: Type.STRING,
          description:
            'Short, punchy answer (1-2 sentences) structured as: Recommendation first; 2 cited reasons; 1 key risk.',
        },
      },
      required: ['question', 'answer'],
    },
  },
  myOpeningLine: {
    type: Type.STRING,
    description:
      'Section 8: Exactly ONE sentence stating my clear, cold-call-ready recommendation to open class discussion.',
  },
};

const SHEET_REQUIRED = [
  'header',
  'decision',
  'situation',
  'keyNumbers',
  'discussionQuestions',
  'frameworks',
  'coldCallReady',
  'myOpeningLine',
];

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    status: {
      type: Type.STRING,
      enum: ['ready', 'missing_info', 'declined'],
      description:
        'Use "declined" if asked to write a graded submission/essay; "missing_info" ONLY in standard mode when the case or a foundational exhibit/dataset required for quantitative analysis is completely missing; "ready" when generating the 8-section prep sheet.',
    },
    missingInfoNote: {
      type: Type.STRING,
      nullable: true,
      description:
        'When status is "missing_info", a short 1-2 sentence note naming specifically which key number or exhibit (e.g., "Exhibit 1") is missing.',
    },
    declineMessage: {
      type: Type.STRING,
      nullable: true,
      description:
        'When status is "declined", a brief refusal stating the app is for personal prep only and does not write graded assignments for submission.',
    },
    mathScratchpad: {
      type: Type.ARRAY,
      nullable: true,
      description:
        'Internal step-by-step verification list completed BEFORE writing sheet (set to null only when status is missing_info or declined). List: (1) exact decision-maker and deadline date; (2) EVERY proposed option or deal/offer structure with exact components so none is skipped; (3) step-by-step arithmetic for valuation multiples vs comps, unit economics (LTV/CAC, price-cut cost), cash vs entry cost, and exact Pro Forma Debt / Pro Forma EBITDA covenant math (checking exact numerator debt items and denominator EBITDA rules) separately for EACH offer structure; (4) any conflicting figures across exhibits/text and any missing sub-cost.',
      items: { type: Type.STRING },
    },
    sheet: {
      type: Type.OBJECT,
      nullable: true,
      description:
        'REQUIRED object when status is "ready" (must NOT be null when status is "ready"); set to null ONLY when status is "missing_info" or "declined".',
      properties: SHEET_PROPERTIES,
      required: SHEET_REQUIRED,
    },
  },
  required: ['status', 'mathScratchpad', 'sheet'],
};

const TIGHTEN_SCHEMA = {
  type: Type.OBJECT,
  properties: SHEET_PROPERTIES,
  required: SHEET_REQUIRED,
};

function buildSystemInstruction(mode: PrepMode): string {
  const modeGuidance =
    mode === 'qualitative'
      ? `QUALITATIVE MODE ACTIVE:
The student explicitly selected "Make a qualitative sheet (no numbers)" after a missing-data prompt.
- You MUST return status: "ready" (unless the input asks to write a graded assignment for submission, which is always "declined").
- Do NOT invent any numbers, financials, multiples, percentages, or exhibits.
- Write a rigorous qualitative 8-section prep sheet using ONLY facts present in the text.
- In Section 4 (Key numbers), provide 3 to 4 concise bullets stating that quantitative figures are omitted due to missing exhibit/numerical data and highlighting qualitative structural constraints cited by page/section, followed by the single Assumptions line naming the missing exhibit(s)/numbers.`
      : `STANDARD MODE ACTIVE:
Read the ENTIRE case (all pages, memos, tables, footnotes, and exhibits) before deciding status:
1. If the user asks you to write a graded assignment, case write-up, memo, or essay for submission, return status: "declined" and explain that this app is strictly for personal class prep only.
2. Check for missing foundational exhibits or key numbers:
   - Return status: "missing_info" (with a short, specific missingInfoNote naming what is missing, e.g., "Exhibit 1 (clinic financials) referenced in the text is missing from the case.") ONLY when:
     (a) The case narrative itself is missing/incomplete, OR
     (b) The case relies on a primary/foundational exhibit or core quantitative dataset (such as Exhibit 1 containing the company's financials) that is completely absent from the provided input, leaving insufficient numbers to evaluate the case quantitatively without guessing.
   - CRITICAL DISTINCTION (Messy Case vs. Incomplete Upload): If the case ALREADY contains substantive quantitative data or exhibits sufficient to analyze the decision (e.g., multiple exhibits or detailed financial/operational metrics exist), DO NOT return "missing_info" even if TWO numbers contradict each other OR one specific sub-cost / secondary exhibit (such as a specific equipment/charger cost schedule) is omitted or left TBD. Instead, return status: "ready", analyze all available numbers accurately, NEVER invent the omitted cost/exhibit, explicitly flag both any conflicting numbers and the omitted exhibit/cost in Key numbers, and record them in the single Assumptions line!`;

  return `You are an elite MBA Case Prep Sheet engine built for personal class participation and cold-call readiness.

${modeGuidance}

NON-NEGOTIABLE RULES:
1. Read the whole case carefully from first line to final exhibit/footnote. Complete \`mathScratchpad\` FIRST to verify every offer structure, option, deadline, formula, numerator, denominator, and covenant definition before writing \`sheet\`. When \`status\` is \`"ready"\`, \`sheet\` MUST be fully populated (never null). Never fill any gap with a guess.
2. NEVER invent numbers, exhibits, page references, calculations, quotes, course names, class dates, or facts that are not in the provided case.
3. HEADER BLANK RULE: In Section 1 (Header), use ONLY the exact Course Name and Class Date provided by the student. If Course Name is blank, leave \`header.course\` as \`""\`. If Class Date is blank, leave \`header.date\` as \`""\`. NEVER guess or invent a course name or date.
4. NEVER use what the real-world company did after the case date, and NEVER bring in outside facts without explicitly labelling them as an assumption.
5. NEVER write graded assignments for submission.
6. Structure \`sheet\` in EXACTLY these 8 sections in order, ending strictly at Section 8 ("My opening line") with NO extra sections:
   (1) Header: case title, plus course and date ONLY if entered by the student (otherwise leave blank).
   (2) Decision: ONE sentence stating who decides what specific choice/options, and by what exact date/deadline (scan memos, footnotes, and closing paragraphs so buried deadlines are never missed).
   (3) Situation: 3 to 4 concise lines, conclusion first in each line.
   (4) Key numbers: 4 to 6 bullets (in standard mode), each leading with what the number implies (conclusion first), followed by the figure, the inline calculation shown, and page or exhibit reference. Directly underneath Key numbers, put EVERY assumption, data gap (e.g., missing sub-exhibit cost), and case quirk (e.g., contradicting figures between text and exhibit) into ONE single "Assumptions:" line.
   (5) Discussion questions: 2 to 3 core discussion questions (use the case's explicit questions if provided, otherwise the central cold-call debate questions) with my answers in 1 to 2 lines each, conclusion first, backed by cited evidence.
   (6) Frameworks: 1 or 2 applicable MBA frameworks, written strictly as: Framework Name -> how it applies to this case -> what it concludes.
   (7) Cold-call ready: EXACTLY 3 likely cold-call questions with short answers. Each answer MUST pack: (a) clear recommendation, (b) 2 evidence-backed reasons with citations, and (c) 1 concrete risk.
   (8) My opening line: ONE crisp sentence stating my recommendation.
7. Lead EVERY bullet and answer with the conclusion first, then the supporting evidence and inline math.
8. Use rigorous MBA course vocabulary tailored to the case discipline (such as NPV, IRR, payback, runway, EBITDA, EV/EBITDA multiple, comps, offer structure, seller note, earnout, debt covenant, pro forma leverage, CAC, LTV, LTV/CAC, churn, STP, the 4Ps, Porter's Five Forces, CAGE distance, entry modes, capex).
9. ANALYTICAL RIGOR ACROSS DOMAINS (DO NOT SKIP OPTIONS OR MISCALCULATE COVENANTS):
   - Finance / Acquisitions / M&A:
     * Flag the implied asking EV/EBITDA multiple against the comparable regional/peer firms' multiple range (with exact math and exhibit refs).
     * Cover ALL proposed offer structures (e.g., if there are 2 offer structures, explicitly state and compare BOTH offer structures in Key numbers—never skip one!).
     * Debt Covenant Precision: Check the exact bank covenant definition in the text/exhibits/footnotes (which debt items count in the numerator: acquirer existing debt + new bank debt + whether seller notes/deferred payments count as debt; and what EBITDA counts in the denominator: acquirer EBITDA + target EBITDA, checking whether projected synergies are excluded). Calculate \`Pro Forma Debt / Pro Forma EBITDA\` with explicit numerator and denominator shown inline for EACH offer structure against the exact covenant limit (e.g., 2.5x).
   - Strategy / Expansion: Compare available cash/budget vs. full entry/launch cost with exact shortfall/surplus arithmetic; check board/contract deadlines.
   - Marketing / Growth: Show exact LTV/CAC trajectory with math, link strategic options directly to quantified customer survey/churn reasons (e.g., % citing a specific reason), and calculate the exact dollar cost of any price cut.
   - Messy / Conflicting Data: Cross-check prose figures against exhibit tables. Explicitly flag conflicting numbers with both references in Key numbers and the Assumptions line, and never invent omitted exhibit costs.
10. Citation discipline: Cite exact Exhibit/Table labels (e.g., "Exhibit 2") or printed page numbers (e.g., "p. 4") present in the source. If plain pasted text has no page numbers and a figure appears in narrative prose rather than an exhibit, cite "(Case text)" rather than inventing a page number.
11. STRICT WORD BUDGET: The ENTIRE rendered prep sheet across all 8 sections (including section headings, excluding \`mathScratchpad\`) MUST be AT OR UNDER 500 WORDS — aim for 380 to 450 words total.`;
}

function sanitizeSheet(
  raw: PrepSheetData,
  providedCourse?: string,
  providedDate?: string
): PrepSheetData {
  const coldCalls = Array.isArray(raw.coldCallReady)
    ? raw.coldCallReady.slice(0, 3)
    : [];
  while (coldCalls.length < 3) {
    coldCalls.push({
      question: 'What is the single biggest execution priority?',
      answer:
        'Prioritize immediate risk mitigation before committing full capital, supported by the core financial constraints and timeline in the case, while monitoring downside operational risk.',
    });
  }

  const situation = Array.isArray(raw.situation)
    ? raw.situation.map((s) => s.trim()).filter(Boolean).slice(0, 4)
    : [];

  const bullets = Array.isArray(raw.keyNumbers?.bullets)
    ? raw.keyNumbers.bullets.map((b) => b.trim()).filter(Boolean).slice(0, 6)
    : [];

  const frameworks = Array.isArray(raw.frameworks)
    ? raw.frameworks.slice(0, 2)
    : [];

  const discussionQuestions = Array.isArray(raw.discussionQuestions)
    ? raw.discussionQuestions.slice(0, 4)
    : [];

  return {
    header: {
      caseTitle: raw.header?.caseTitle?.trim() || 'Untitled Business Case',
      // Strictly use ONLY what the student entered; if blank, keep empty string "" (never guess)
      course: (providedCourse ?? '').trim(),
      date: (providedDate ?? '').trim(),
    },
    decision: (raw.decision || '').trim(),
    situation,
    keyNumbers: {
      bullets,
      assumptionsLine: normalizeAssumptionsText(
        raw.keyNumbers?.assumptionsLine || ''
      ),
    },
    discussionQuestions: discussionQuestions.map((dq) => ({
      question: (dq.question || '').trim(),
      answer: (dq.answer || '').trim(),
    })),
    frameworks: frameworks.map((fw) => ({
      name: (fw.name || '').trim(),
      application: (fw.application || '').trim(),
      conclusion: (fw.conclusion || '').trim(),
    })),
    coldCallReady: coldCalls.map((cc) => ({
      question: (cc.question || '').trim(),
      answer: (cc.answer || '').trim(),
    })),
    myOpeningLine: (raw.myOpeningLine || '').trim(),
  };
}

async function tightenSheetUnder500Words(
  ai: GoogleGenAI,
  sheet: PrepSheetData,
  currentWords: number,
  courseName?: string,
  classDate?: string,
  preferModel?: string
): Promise<PrepSheetData> {
  let working = sheet;
  let words = currentWords;

  for (let attempt = 0; attempt < 2 && words > 485; attempt++) {
    const targetWords = attempt === 0 ? 450 : 415;
    const wordsToCut = words - targetWords;
    const rendered = formatPrepSheetPlainText(working);

    const { response } = await generateWithFallback(
      ai,
      {
        contents: `The following 8-section MBA case prep sheet is currently ${words} words (including section headers), exceeding the strict 500-word maximum.

Cut at least ${wordsToCut} words so the total rendered sheet (including section headers) is at or below ${targetWords} words.

CRITICAL PRESERVATION RULES:
- Keep ALL 8 sections in exact order, ending at My opening line.
- Keep EVERY exact number, multiple, ratio, dollar figure, inline calculation, deadline date, ALL offer structures, exact debt covenant math, conflicting-number warning, and page/exhibit citation.
- If header.course or header.date is empty "", keep it empty "".
- Keep conclusion-first phrasing on every bullet and answer.
- Keep 3 to 4 lines in Situation, 4 to 6 bullets in Key numbers (if quantitative), ONE Assumptions line, 1 to 2 Frameworks, and EXACTLY 3 Cold-call ready Q&As (each with recommendation, 2 reasons, 1 risk).
- Tighten only wordy filler, articles, and phrasing redundancy—never invent or alter facts.

CURRENT DRAFT (${words} words):
${rendered}

CURRENT JSON:
${JSON.stringify(working)}`,
        config: {
          systemInstruction:
            'You are a precision MBA copy-editor. Compress prose to stay strictly under 500 total words while preserving 100% of figures, formulas, all offer structures, covenant checks, citations, deadlines, contradictions, and all 8 sections.',
          responseMimeType: 'application/json',
          responseSchema: TIGHTEN_SCHEMA,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      },
      'TightenPrepSheet',
      preferModel
    );

    const rawTightened = (response.text ?? '').trim();
    if (!rawTightened) break;
    const parsed = parseModelJson<PrepSheetData>(rawTightened, 'TightenPrepSheet');
    working = sanitizeSheet(parsed, courseName, classDate);
    words = countPrepSheetWords(working);
  }

  return working;
}

export async function generateCasePrepSheet(
  payload: PrepSheetRequestPayload
): Promise<PrepSheetApiResponse> {
  const mode: PrepMode = payload.mode === 'qualitative' ? 'qualitative' : 'standard';
  const hasPrimaryPdf = Boolean(payload.pdfAttachment?.base64Data);
  const hasPrimaryText = Boolean(payload.caseText?.trim());
  const hasSupplementalPdf = Boolean(payload.supplementalPdf?.base64Data);
  const hasSupplementalText = Boolean(payload.supplementalText?.trim());

  if (!hasPrimaryPdf && !hasPrimaryText && !hasSupplementalPdf && !hasSupplementalText) {
    return {
      status: 'missing_info',
      mode,
      missingInfoNote:
        'No case text or PDF was provided. Upload a case PDF or paste the case text to generate a prep sheet.',
    };
  }

  let ai: GoogleGenAI;
  try {
    ai = getAiClient();
  } catch (err) {
    throw toCasePrepError(err, 'InitGeminiClient');
  }

  const parts: Array<
    | { text: string }
    | { inlineData: { mimeType: string; data: string } }
  > = [];

  const metaLines: string[] = [
    `Preparation Mode: ${mode === 'qualitative' ? 'Qualitative sheet (no numbers)' : 'Standard quantitative + strategic prep sheet'}`,
    `Student-Provided Course Name: ${payload.courseName?.trim() ? payload.courseName.trim() : '(Blank — leave header.course as "")'}`,
    `Student-Provided Class Date: ${payload.classDate?.trim() ? payload.classDate.trim() : '(Blank — leave header.date as "")'}`,
  ];

  parts.push({
    text: `SESSION METADATA:\n${metaLines.join('\n')}\n\nRead all attached/pasted case materials completely, fill mathScratchpad carefully first, and then generate the sheet.`,
  });

  if (hasPrimaryPdf && payload.pdfAttachment) {
    parts.push({
      inlineData: {
        mimeType: payload.pdfAttachment.mimeType || 'application/pdf',
        data: payload.pdfAttachment.base64Data,
      },
    });
  }

  if (hasPrimaryText && payload.caseText) {
    parts.push({
      text: `PRIMARY CASE TEXT:\n${payload.caseText.trim()}`,
    });
  }

  if (hasSupplementalPdf && payload.supplementalPdf) {
    parts.push({
      text: 'SUPPLEMENTAL EXHIBIT / MISSING DATA PDF PROVIDED BY STUDENT:',
    });
    parts.push({
      inlineData: {
        mimeType: payload.supplementalPdf.mimeType || 'application/pdf',
        data: payload.supplementalPdf.base64Data,
      },
    });
  }

  if (hasSupplementalText && payload.supplementalText) {
    parts.push({
      text: `SUPPLEMENTAL EXHIBIT / MISSING DATA TEXT PROVIDED BY STUDENT:\n${payload.supplementalText.trim()}`,
    });
  }

  const { response, modelUsed } = await generateWithFallback(
    ai,
    {
      contents: { parts },
      config: {
        systemInstruction: buildSystemInstruction(mode),
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
      },
    },
    'GenerateCasePrepSheet'
  );

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    const finishReason = response.candidates?.[0]?.finishReason ?? 'UNKNOWN';
    console.error(
      `[CasePrep] Empty response.text from Gemini (finishReason=${finishReason})`
    );
    throw new CasePrepError({
      message: `Empty model output (finishReason=${finishReason})`,
      userMessage: `Gemini returned an empty response (reason: ${finishReason}). Please try again.`,
      statusCode: 502,
      code: 'EMPTY_MODEL_RESPONSE',
    });
  }

  const parsed = parseModelJson<{
    status: 'ready' | 'missing_info' | 'declined';
    missingInfoNote?: string | null;
    declineMessage?: string | null;
    mathScratchpad?: string[] | null;
    sheet?: PrepSheetData | null;
  }>(rawText, 'GenerateCasePrepSheet');

  if (parsed.status === 'declined') {
    return {
      status: 'declined',
      mode,
      declineMessage:
        parsed.declineMessage?.trim() ||
        'This app is for personal class prep only and cannot write graded assignments for submission.',
    };
  }

  if (parsed.status === 'missing_info' && mode === 'standard') {
    return {
      status: 'missing_info',
      mode,
      missingInfoNote:
        parsed.missingInfoNote?.trim() ||
        'A key exhibit or financial schedule referenced in the case is missing from the provided material.',
    };
  }

  if (!parsed.sheet) {
    return {
      status: 'missing_info',
      mode,
      missingInfoNote:
        parsed.missingInfoNote?.trim() ||
        'The case is missing core information required to build the prep sheet.',
    };
  }

  let finalSheet = sanitizeSheet(parsed.sheet, payload.courseName, payload.classDate);
  let wordCount = countPrepSheetWords(finalSheet);

  if (wordCount > 485) {
    finalSheet = await tightenSheetUnder500Words(
      ai,
      finalSheet,
      wordCount,
      payload.courseName,
      payload.classDate,
      modelUsed
    );
    wordCount = countPrepSheetWords(finalSheet);
  }

  return {
    status: 'ready',
    mode,
    sheet: finalSheet,
    wordCount,
  };
}
