import { describe, expect, it } from 'vitest';
import { publicBaseUrl } from './url';

describe('publicBaseUrl', () => {
  it('expands a Render private host name to its public address', () => {
    expect(publicBaseUrl('crave-api-ab12')).toBe('https://crave-api-ab12.onrender.com');
  });
  it('adds https to dotted hosts and keeps full URLs', () => {
    expect(publicBaseUrl('crave-app-bq5e.onrender.com')).toBe('https://crave-app-bq5e.onrender.com');
    expect(publicBaseUrl('https://api.example.com/')).toBe('https://api.example.com');
    expect(publicBaseUrl('http://localhost:8787')).toBe('http://localhost:8787');
  });
  it('uses http for local hosts and returns empty for nothing', () => {
    expect(publicBaseUrl('localhost:8081')).toBe('http://localhost:8081');
    expect(publicBaseUrl('')).toBe('');
    expect(publicBaseUrl(undefined)).toBe('');
  });
});
