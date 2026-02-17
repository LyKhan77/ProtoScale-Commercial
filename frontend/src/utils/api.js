/**
 * Custom fetch wrapper that adds ngrok-skip-browser-warning header
 * for ngrok free tier compatibility
 */

const API_BASE = import.meta.env.VITE_API_URL || '';

export async function apiFetch(url, options = {}) {
  const headers = {
    'ngrok-skip-browser-warning': 'true',
    ...options.headers
  };

  const fullUrl = url.startsWith('http') ? url : `${API_BASE}${url}`;

  return fetch(fullUrl, {
    ...options,
    headers
  });
}

export { API_BASE };
