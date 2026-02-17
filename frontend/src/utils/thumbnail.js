/**
 * Utility untuk load thumbnail dengan custom headers
 * Mengatasi ngrok blocking dan CORS issues
 */

/**
 * Load thumbnail dari backend dan convert ke blob URL
 * @param {string} url - URL thumbnail dari backend
 * @returns {Promise<string>} Blob URL yang bisa digunakan di <img> tag
 */
export async function loadThumbnailAsBlob(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'ngrok-skip-browser-warning': 'true',
      },
      credentials: 'include',
    });

    if (!response.ok) {
      console.warn(`Failed to load thumbnail: ${response.status}`);
      return null;
    }

    const blob = await response.blob();
    return URL.createObjectURL(blob);
  } catch (error) {
    console.error('Error loading thumbnail:', error);
    return null;
  }
}

/**
 * Cleanup blob URL untuk prevent memory leaks
 * @param {string} blobUrl - Blob URL yang akan di-cleanup
 */
export function revokeThumbnailBlob(blobUrl) {
  if (blobUrl && blobUrl.startsWith('blob:')) {
    URL.revokeObjectURL(blobUrl);
  }
}
