import 'dotenv/config';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import {
  CasePrepError,
  generateCasePrepSheet,
  sanitizeSecretFromText,
} from './src/server/casePrepService.ts';
import type { PrepSheetRequestPayload } from './src/types/prepSheet.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT) || 3000;

  // Process uploaded PDFs/text strictly in memory with no disk storage or case-content logging
  app.use(express.json({ limit: '40mb' }));

  app.post('/api/prep-sheet', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');

    try {
      const payload = (req.body ?? {}) as PrepSheetRequestPayload;
      const result = await generateCasePrepSheet(payload);
      res.status(200).json(result);
    } catch (err: unknown) {
      if (err instanceof CasePrepError) {
        console.error(
          `[CasePrep] /api/prep-sheet error [${err.code}] (HTTP ${err.statusCode}): ${sanitizeSecretFromText(err.message)}`
        );
        res.status(err.statusCode).json({
          error: err.userMessage,
          code: err.code,
          details: sanitizeSecretFromText(err.message),
        });
        return;
      }

      const safeMessage = sanitizeSecretFromText(
        err instanceof Error ? err.message : String(err ?? 'Unknown server error')
      );
      const safeStack = err instanceof Error && err.stack
        ? sanitizeSecretFromText(err.stack)
        : undefined;

      console.error('[CasePrep] Unexpected /api/prep-sheet error:', safeMessage);
      if (safeStack) {
        console.error(safeStack);
      }

      res.status(500).json({
        error: `Prep sheet generation failed: ${safeMessage}`,
        code: 'UNEXPECTED_SERVER_ERROR',
        details: safeMessage,
      });
    }
  });

  // Handle oversized JSON payloads cleanly with plain-language reason
  app.use((err: Error & { type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    if (err?.type === 'entity.too.large') {
      console.error('[CasePrep] Payload exceeded 40MB JSON limit.');
      res.status(413).json({
        error: 'The uploaded PDF exceeds the 30 MB in-memory limit. Upload a smaller PDF or paste the case text.',
        code: 'PAYLOAD_TOO_LARGE',
      });
      return;
    }
    const safeMsg = sanitizeSecretFromText(err?.message || 'Invalid request payload.');
    console.error('[CasePrep] Express request error:', safeMsg);
    res.status(400).json({
      error: `Request error: ${safeMsg}`,
      code: 'BAD_REQUEST',
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`CasePrep server running on http://0.0.0.0:${port}`);
  });
}

startServer();
