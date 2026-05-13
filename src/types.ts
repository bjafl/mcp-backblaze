export interface B2AuthResponse {
  accountId: string;
  authorizationToken: string;
  apiInfo: {
    storageApi: {
      apiUrl: string;
      downloadUrl: string;
      absoluteMinimumPartSize: number;
      recommendedPartSize: number;
      allowed: {
        buckets: string[];
        capabilities: string[];
        namePrefix: string | null;
      };
    };
  };
}

export interface B2Bucket {
  accountId: string;
  bucketId: string;
  bucketName: string;
  bucketType: string;
  bucketInfo: Record<string, unknown>;
  lifecycleRules: unknown[];
  revision: number;
  options: string[];
}

export interface B2FileInfo {
  accountId: string;
  action: string;
  bucketId: string;
  contentLength: number;
  contentSha1: string;
  contentType: string;
  fileId: string;
  fileName: string;
  fileInfo: Record<string, string>;
  uploadTimestamp: number;
}

export interface B2UploadUrlResponse {
  bucketId: string;
  uploadUrl: string;
  authorizationToken: string;
}

export interface AuthState {
  token: string;
  apiUrl: string;
  downloadUrl: string;
  accountId: string;
  expiresAt: number;
}

export interface ListFilesResult {
  files: B2FileInfo[];
  nextFileName: string | null;
}

export interface DeleteResult {
  fileId: string;
  fileName: string;
}
