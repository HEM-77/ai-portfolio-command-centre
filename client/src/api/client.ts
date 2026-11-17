import * as mock from '../mocks/contract';
import type { AskResult, DataQualityReport, Envelope, InitiativesResponse, PortfolioSummary, WeeklyBrief } from '../types/api';

const BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api').replace(/\/$/, '');
export const mockMode = import.meta.env.VITE_USE_MOCKS === 'true';

export class ApiError extends Error { constructor(message: string, readonly code: string) { super(message); } }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(`${BASE}${path}`, init); }
  catch { throw new ApiError('Cannot reach the server. Check that it is running, then retry.', 'NETWORK_ERROR'); }
  let body: Envelope<T>;
  try { body = await response.json() as Envelope<T>; }
  catch { throw new ApiError('The server returned an invalid response.', 'INVALID_RESPONSE'); }
  if (!body.ok) throw new ApiError(body.error.message, body.error.code);
  if (!response.ok) throw new ApiError('The server returned an unexpected status.', 'INVALID_RESPONSE');
  return body.data;
}

export const api = {
  summary: (): Promise<PortfolioSummary> => mockMode ? Promise.resolve(mock.summary) : request('/portfolio/summary'),
  initiatives: (): Promise<InitiativesResponse> => mockMode ? Promise.resolve(mock.initiatives) : request('/portfolio/initiatives'),
  quality: (): Promise<DataQualityReport> => mockMode ? Promise.resolve(mock.quality) : request('/portfolio/quality'),
  weekly: (): Promise<WeeklyBrief> => mockMode ? Promise.resolve(mock.weekly) : request('/reports/weekly'),
  ask: (question: string): Promise<AskResult> => {
    if (mockMode) return Promise.resolve(/no evidence/i.test(question) ? mock.noEvidenceAnswer : /unverified/i.test(question) ? mock.unverifiedAnswer : mock.verifiedAnswer);
    return request('/assistant/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) });
  },
};
