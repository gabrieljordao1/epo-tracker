/**
 * Utility Tests
 * Tests health check and export URL generation
 */

import { healthCheck, getExportCSVUrl } from '@/lib/api';

describe('healthCheck', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should return true when API is healthy', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ status: 'healthy' }),
    });

    const result = await healthCheck();
    expect(result).toBe(true);
  });

  it('should return false when API is down', async () => {
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('Network error'));

    const result = await healthCheck();
    expect(result).toBe(false);
  });

  it('should return false on non-ok response', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
    });

    const result = await healthCheck();
    expect(result).toBe(false);
  });
});

describe('getExportCSVUrl', () => {
  it('should return base URL with no filters', () => {
    const url = getExportCSVUrl();
    expect(url).toContain('/api/exports/epos/csv');
    expect(url).not.toContain('?');
  });

  it('should add status filter', () => {
    const url = getExportCSVUrl({ status: 'pending' });
    expect(url).toContain('status_filter=pending');
  });

  it('should skip "all" status filter', () => {
    const url = getExportCSVUrl({ status: 'all' });
    expect(url).not.toContain('status_filter');
  });

  it('should add multiple filters', () => {
    const url = getExportCSVUrl({
      status: 'confirmed',
      vendor: 'Acme',
      community: 'Sunrise',
      days: 30,
    });
    expect(url).toContain('status_filter=confirmed');
    expect(url).toContain('vendor=Acme');
    expect(url).toContain('community=Sunrise');
    expect(url).toContain('days=30');
  });
});
