import { describe, expect, it } from 'vitest';
import { patientsSql } from '../lib/hosxp/sql';
import { TUNNEL_BAD_URL_LENGTH, buildSqlUrl, parseSensitiveBlocked } from './bmsSession';

const API = 'https://10673-tannam.tunnel.hosxp.net';
/** A query whose URL falls inside the length band the tunnel rejects (~2.4 KB). */
const LONG_SQL = `SELECT ${Array.from({ length: 300 }, (_, i) => `c${i}`).join(', ')} FROM t`;

describe('privacy protection', () => {
  const message =
    'SENSITIVE_BLOCKED: the statement uses protected fields in a way that would reveal or derive from their values (EXPRESSION:patient.fname). It was not run. Ask the user to approve authorization request authreq_1dbdc5921b3a694e288ae3e97598ebbf in the application, then run the same SQL with privacy_request_id.';

  it('extracts the authorization request id', () => {
    expect(parseSensitiveBlocked(message)).toBe('authreq_1dbdc5921b3a694e288ae3e97598ebbf');
    expect(parseSensitiveBlocked('Invalid authorization')).toBeUndefined();
  });

  it('re-sends exactly the same SQL when retrying with privacy_request_id', () => {
    for (const sql of ['SELECT 1', LONG_SQL, patientsSql('postgresql', '2026-10-24', '2026-10-24')]) {
      const first = new URL(buildSqlUrl(API, sql));
      const retry = new URL(buildSqlUrl(API, sql, 'authreq_abc123'));
      expect(retry.searchParams.get('sql')).toBe(first.searchParams.get('sql'));
      expect(retry.searchParams.get('privacy_request_id')).toBe('authreq_abc123');
    }
  });
});

describe('buildSqlUrl', () => {
  it('leaves short queries untouched', () => {
    expect(buildSqlUrl(API, 'SELECT 1')).toBe(`${API}/api/sql?sql=SELECT%201&app=BMS.Dashboard.React`);
  });

  it('moves URLs out of the length band the tunnel rejects', () => {
    for (const sql of [LONG_SQL, patientsSql('postgresql', '2026-10-24', '2026-10-24')]) {
      const url = buildSqlUrl(API, sql);
      expect(url.length < TUNNEL_BAD_URL_LENGTH.from || url.length >= TUNNEL_BAD_URL_LENGTH.to).toBe(true);
    }
  });

  it('only appends a trailing line comment, so the SQL itself is unchanged', () => {
    const url = buildSqlUrl(API, LONG_SQL);
    const sent = decodeURIComponent(new URL(url).searchParams.get('sql')!);
    expect(sent).toMatch(/ -- -+$/);
    expect(sent.replace(/ -- -+$/, '')).not.toContain('--');
  });
});
