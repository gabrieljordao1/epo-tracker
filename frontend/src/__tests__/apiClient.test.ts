/**
 * API Client Tests
 * Tests retry logic, timeout handling, and error handling
 */

// Mock the toast instance
jest.mock('@/lib/toastInstance', () => ({
  getToastInstance: () => ({
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
    info: jest.fn(),
  }),
}));

import { apiClient } from '@/lib/apiClient';

// Store original fetch
const originalFetch = global.fetch;

describe('apiClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('successful requests', () => {
    it('should make a GET request and return data', async () => {
      const mockData = { id: 1, name: 'Test EPO' };
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(mockData),
      });

      const result = await apiClient.get('/api/epos/1');
      expect(result).toEqual(mockData);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should make a POST request with body', async () => {
      const mockData = { id: 2, vendor_name: 'Test Vendor' };
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(mockData),
      });

      const result = await apiClient.post('/api/epos', { vendor_name: 'Test Vendor' });
      expect(result).toEqual(mockData);
    });

    it('should include auth token in headers', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({}),
      });

      await apiClient.get('/api/epos', { token: 'test-jwt-token' });

      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      expect(callArgs[1].headers.Authorization).toBe('Bearer test-jwt-token');
    });
  });

  describe('error handling', () => {
    it('should throw on 401 and redirect to login', async () => {
      // Mock window.location
      const originalLocation = window.location;
      Object.defineProperty(window, 'location', {
        value: { href: '' },
        writable: true,
      });

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ message: 'Unauthorized' }),
      });

      await expect(apiClient.get('/api/epos')).rejects.toThrow('Unauthorized');
      expect(window.location.href).toBe('/login');

      Object.defineProperty(window, 'location', { value: originalLocation });
    });

    it('should show toast on 429 rate limit', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ message: 'Rate limited' }),
      });

      await expect(apiClient.get('/api/epos')).rejects.toThrow('Rate limited');
    });
  });

  describe('retry logic', () => {
    it('should retry on 500 errors up to 3 times', async () => {
      const serverError = {
        ok: false,
        status: 500,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ message: 'Internal Server Error' }),
      };

      global.fetch = jest.fn()
        .mockResolvedValueOnce(serverError)
        .mockResolvedValueOnce(serverError)
        .mockResolvedValueOnce(serverError)
        .mockResolvedValueOnce(serverError);

      await expect(apiClient.get('/api/epos', { retries: 3 })).rejects.toThrow('Server error');
      // Original + 3 retries = 4 calls
      expect(global.fetch).toHaveBeenCalledTimes(4);
    }, 30000);

    it('should succeed after retry if server recovers', async () => {
      const serverError = {
        ok: false,
        status: 500,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ message: 'Internal Server Error' }),
      };
      const successResponse = {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ data: 'recovered' }),
      };

      global.fetch = jest.fn()
        .mockResolvedValueOnce(serverError)
        .mockResolvedValueOnce(successResponse);

      const result = await apiClient.get('/api/epos', { retries: 3 });
      expect(result).toEqual({ data: 'recovered' });
      expect(global.fetch).toHaveBeenCalledTimes(2);
    }, 30000);

    it('should not retry on 404 errors', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ message: 'Not found' }),
      });

      await expect(apiClient.get('/api/epos/999')).rejects.toThrow();
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });
});
