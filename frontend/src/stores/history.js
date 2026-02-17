import { defineStore } from 'pinia';
import { ref } from 'vue';
import { apiFetch, API_BASE } from '../utils/api';
import { loadThumbnailAsBlob, revokeThumbnailBlob } from '../utils/thumbnail';
const STORAGE_KEY = 'protoscale-history';

export const useHistoryStore = defineStore('history', () => {
  const items = ref([]);
  const backendOnline = ref(null); // null = unknown, true = online, false = offline

  function getLocalData() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function saveLocalData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  async function loadHistory(retries = 2, delay = 3000) {
    try {
      const res = await apiFetch(`/api/jobs`);
      if (!res.ok) {
        if (res.status >= 500 && retries > 0) {
          console.warn(`[History] Server error ${res.status}, retrying in ${delay}ms (${retries} left)`);
          setTimeout(() => loadHistory(retries - 1, delay), delay);
          return;
        }
        backendOnline.value = false;
        return;
      }
      backendOnline.value = true;
      const jobs = await res.json();
      const local = getLocalData();
      const localMap = Object.fromEntries(local.map(l => [l.jobId, l]));

      // Cleanup old blob URLs
      items.value.forEach(item => {
        if (item.thumbnailBlobUrl) {
          revokeThumbnailBlob(item.thumbnailBlobUrl);
        }
      });

      // Preserve in-progress items (don't overwrite with backend data)
      const inProgressItems = items.value.filter(i => i.status === 'in_progress');

      // Map jobs with initial thumbnail URLs
      const mappedJobs = jobs.map(job => ({
        jobId: job.job_id,
        name: localMap[job.job_id]?.name || job.job_id.slice(0, 8),
        thumbnailUrl: `${API_BASE}/api/jobs/${job.job_id}/thumbnail`,
        thumbnailBlobUrl: null, // Will be loaded async
        createdAt: job.created_at,
        modelVersion: job.model_version,
        deprecated: job.deprecated || job.model_version === 'v2.0',
        qualityPreset: job.quality_preset,
        status: 'completed', // Backend jobs are completed
      }));

      // Merge: in-progress items first, then completed jobs (avoid duplicates)
      // Keep in-progress items and exclude their completed counterparts
      const inProgressJobIds = new Set(inProgressItems.map(ip => ip.jobId));
      const filteredCompletedJobs = mappedJobs.filter(j => !inProgressJobIds.has(j.jobId));

      items.value = [...inProgressItems, ...filteredCompletedJobs];

      // Load thumbnails asynchronously with proper headers
      mappedJobs.forEach(async (job) => {
        try {
          const blobUrl = await loadThumbnailAsBlob(job.thumbnailUrl);
          if (blobUrl) {
            // Find by jobId to avoid index mismatch when in-progress items are prepended
            const item = items.value.find(i => i.jobId === job.jobId);
            if (item) {
              item.thumbnailBlobUrl = blobUrl;
            }
          }
        } catch (e) {
          console.warn(`Failed to load thumbnail for ${job.jobId}:`, e);
        }
      });
    } catch (e) {
      console.warn('Failed to load history:', e);
      backendOnline.value = false;
      if (retries > 0) {
        console.warn(`[History] Retrying in ${delay}ms (${retries} left)`);
        setTimeout(() => loadHistory(retries - 1, delay), delay);
      }
    }
  }

  function saveToHistory(jobId) {
    const local = getLocalData();
    if (!local.find(l => l.jobId === jobId)) {
      local.unshift({ jobId, name: jobId.slice(0, 8) });
      saveLocalData(local);
    }
    // Reload to sync with backend
    loadHistory();
  }

  function deleteFromHistory(jobId) {
    const local = getLocalData().filter(l => l.jobId !== jobId);
    saveLocalData(local);
    items.value = items.value.filter(i => i.jobId !== jobId);
  }

  async function deleteModel(jobId) {
    const res = await apiFetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete model');
    deleteFromHistory(jobId);
  }

  // --- In-Progress Job Tracking ---

  function addInProgressJob(bgOperation) {
    const inProgressItem = {
      jobId: bgOperation.jobId,
      name: bgOperation.jobId.slice(0, 8),
      thumbnailUrl: null,
      thumbnailBlobUrl: null,
      createdAt: new Date().toISOString(),
      qualityPreset: null, // Will be set when job completes
      status: 'in_progress',
      progress: bgOperation.progress || 0,
      stage: bgOperation.stage || null,
      type: bgOperation.type, // 'generate' | 'texture'
      startedAt: bgOperation.startedAt
    };

    const existingIndex = items.value.findIndex(i => i.jobId === bgOperation.jobId);

    if (existingIndex >= 0) {
      items.value[existingIndex] = inProgressItem;
    } else {
      items.value.unshift(inProgressItem); // Add at beginning
    }
  }

  function updateInProgressJob(jobId, updates) {
    const item = items.value.find(i => i.jobId === jobId && i.status === 'in_progress');
    if (item) {
      item.progress = updates.progress ?? item.progress;
      item.stage = updates.stage ?? item.stage;
      item.type = updates.type ?? item.type;
    }
  }

  function markJobCompleted(jobId) {
    const item = items.value.find(i => i.jobId === jobId);
    if (item) {
      item.status = 'completed';
      item.progress = 100;
    }

    // Reload history to get thumbnail
    loadHistory();
  }

  function removeInProgressJob(jobId) {
    const index = items.value.findIndex(i => i.jobId === jobId && i.status === 'in_progress');
    if (index >= 0) {
      items.value.splice(index, 1);
    }
  }

  return {
    items,
    backendOnline,
    loadHistory,
    saveToHistory,
    deleteFromHistory,
    deleteModel,
    addInProgressJob,
    updateInProgressJob,
    markJobCompleted,
    removeInProgressJob
  };
});
