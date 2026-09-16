import type {
  ProjectAnalysis,
  ProjectDocumentationReport,
  ProjectFileResponse,
  ProjectUploadResponse,
} from './types';

const API_URL = (
  import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'
).replace(/\/$/, '');

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${API_URL}${path}`;

  console.log('[API] REQUEST:', url);

  let response: Response;

  try {
    response = await fetch(url, options);
  } catch (error) {
    console.error('[API] NETWORK ERROR:', url, error);

    throw new Error(
      `Ошибка подключения к API: ${url}`,
    );
  }

  console.log('[API] RESPONSE:', response.status, url);

  const contentType = response.headers.get('content-type') || '';

  const data = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => '');

  if (!response.ok) {
    const detail =
      typeof data === 'object' &&
      data &&
      'detail' in data
        ? String(data.detail)
        : '';

    console.error('[API] HTTP ERROR:', response.status, data);

    throw new Error(
      detail || `Ошибка API: ${response.status}`,
    );
  }

  return data as T;
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map(encodeURIComponent)
    .join('/');
}

export const api = {
  uploadProject(file: File) {
    const form = new FormData();
    form.append('file', file);

    return request<ProjectUploadResponse>(
      '/projects/upload',
      {
        method: 'POST',
        body: form,
      },
    );
  },

  getProject(id: string) {
    return request<ProjectAnalysis>(
      `/projects/${encodeURIComponent(id)}`,
    );
  },

  getFile(id: string, path: string) {
    return request<ProjectFileResponse>(
      `/projects/${encodeURIComponent(id)}/files/${encodePath(path)}`,
    );
  },

  getDocumentation(id: string) {
    return request<ProjectDocumentationReport>(
      `/projects/${encodeURIComponent(id)}/documentation`,
    );
  },
};