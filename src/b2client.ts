import axios, { AxiosError } from 'axios';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type {
  AuthState,
  B2AuthResponse,
  B2Bucket,
  B2FileInfo,
  B2UploadUrlResponse,
  DeleteResult,
  ListFilesResult,
} from './types.js';

const AUTH_URL = 'https://api.backblazeb2.com/b2api/v4/b2_authorize_account';
const TOKEN_TTL_MS = 23 * 60 * 60 * 1000; // 23h (buffer before 24h expiry)

let authState: AuthState | null = null;

export async function authorize(): Promise<AuthState> {
  if (authState && Date.now() < authState.expiresAt) {
    return authState;
  }

  const keyId = process.env.B2_APPLICATION_KEY_ID;
  const key = process.env.B2_APPLICATION_KEY;
  if (!keyId || !key) {
    throw new Error('B2_APPLICATION_KEY_ID and B2_APPLICATION_KEY must be set');
  }

  const credentials = Buffer.from(`${keyId}:${key}`).toString('base64');
  const response = await axios.get<B2AuthResponse>(AUTH_URL, {
    headers: { Authorization: `Basic ${credentials}` },
    timeout: 30000,
  });

  const { authorizationToken, apiInfo, accountId } = response.data;
  authState = {
    token: authorizationToken,
    apiUrl: apiInfo.storageApi.apiUrl,
    downloadUrl: apiInfo.storageApi.downloadUrl,
    accountId,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  };
  return authState;
}

export async function listBuckets(): Promise<B2Bucket[]> {
  const auth = await authorize();
  const response = await axios.post<{ buckets: B2Bucket[] }>(
    `${auth.apiUrl}/b2api/v4/b2_list_buckets`,
    { accountId: auth.accountId },
    { headers: { Authorization: auth.token }, timeout: 30000 }
  );
  return response.data.buckets;
}

export async function listFiles(
  bucketId: string,
  prefix?: string,
  maxFileCount: number = 100,
  startFileName?: string
): Promise<ListFilesResult> {
  const auth = await authorize();
  const params: Record<string, unknown> = { bucketId, maxFileCount };
  if (prefix) params.prefix = prefix;
  if (startFileName) params.startFileName = startFileName;

  const response = await axios.get<ListFilesResult>(
    `${auth.apiUrl}/b2api/v4/b2_list_file_names`,
    { headers: { Authorization: auth.token }, params, timeout: 30000 }
  );
  return response.data;
}

export async function uploadFile(
  bucketId: string,
  fileName: string,
  filePath: string,
  contentType: string = 'b2/x-auto'
): Promise<B2FileInfo> {
  const auth = await authorize();

  const urlResponse = await axios.get<B2UploadUrlResponse>(
    `${auth.apiUrl}/b2api/v4/b2_get_upload_url`,
    { headers: { Authorization: auth.token }, params: { bucketId }, timeout: 30000 }
  );
  const { uploadUrl, authorizationToken: uploadToken } = urlResponse.data;

  const fileBuffer = readFileSync(filePath);
  const sha1 = createHash('sha1').update(fileBuffer).digest('hex');
  const encodedName = encodeURIComponent(fileName).replace(/%2F/g, '/');

  const response = await axios.post<B2FileInfo>(uploadUrl, fileBuffer, {
    headers: {
      Authorization: uploadToken,
      'X-Bz-File-Name': encodedName,
      'Content-Type': contentType,
      'Content-Length': fileBuffer.length,
      'X-Bz-Content-Sha1': sha1,
    },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    timeout: 120000,
  });
  return response.data;
}

export async function downloadFile(bucketName: string, fileName: string): Promise<Buffer> {
  const auth = await authorize();
  const encodedName = encodeURIComponent(fileName).replace(/%2F/g, '/');
  const response = await axios.get<ArrayBuffer>(
    `${auth.downloadUrl}/file/${bucketName}/${encodedName}`,
    {
      headers: { Authorization: auth.token },
      responseType: 'arraybuffer',
      timeout: 120000,
    }
  );
  return Buffer.from(response.data);
}

export async function deleteFile(fileName: string, fileId: string): Promise<DeleteResult> {
  const auth = await authorize();
  const response = await axios.post<DeleteResult>(
    `${auth.apiUrl}/b2api/v4/b2_delete_file_version`,
    { fileName, fileId },
    { headers: { Authorization: auth.token }, timeout: 30000 }
  );
  return response.data;
}

export async function getFileInfo(fileId: string): Promise<B2FileInfo> {
  const auth = await authorize();
  const response = await axios.get<B2FileInfo>(
    `${auth.apiUrl}/b2api/v4/b2_get_file_info`,
    { headers: { Authorization: auth.token }, params: { fileId }, timeout: 30000 }
  );
  return response.data;
}

export function handleApiError(error: unknown): string {
  if (error instanceof AxiosError) {
    const data = error.response?.data as { code?: string; message?: string } | undefined;
    const code = data?.code ?? 'unknown';
    const message = data?.message ?? error.message;
    const status = error.response?.status ?? 0;
    switch (status) {
      case 400: return `Error (${code}): ${message}. Check parameter values.`;
      case 401: return `Error (${code}): Auth failed — ${message}. Check B2_APPLICATION_KEY_ID and B2_APPLICATION_KEY.`;
      case 403: return `Error (${code}): Access denied — ${message}. Check application key capabilities.`;
      case 404: return `Error: Not found — ${message}.`;
      case 429: return `Error: Rate limit exceeded. Wait before retrying.`;
      case 503: return `Error: Service unavailable. Retry after a moment.`;
      default: return `Error (${code}): ${message}`;
    }
  }
  return `Error: ${error instanceof Error ? error.message : String(error)}`;
}
