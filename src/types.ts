export interface B2AuthResponse {
  accountId: string;
  authorizationToken: string;
  applicationKeyExpirationTimestamp: number | null;
  apiInfo: B2ApiInfo;
}

export interface B2ApiInfo {
  storageApi: B2StorageApiInfo;
  groupsApi: unknown; //TODO
}

export interface B2StorageApiInfo {
  apiUrl: string;
  downloadUrl: string;
  absoluteMinimumPartSize: number;
  recommendedPartSize: number;
  s3ApiUrl: string;
  allowed: {
    buckets: B2BucketRef[] | null;
    capabilities: string[];
    namePrefix: string | null;
  };
}

export type B2StorageCapabilities = [
  "deleteFiles",
  "deleteKeys",
  "readBucketEncryption",
  "writeKeys",
  "writeBuckets",
  "writeBucketNotifications",
  "writeBucketReplications",
  "readBucketNotifications",
  "readBucketReplications",
  "deleteBuckets",
  "readBuckets",
  "bypassGovernance",
  "readFileLegalHolds",
  "readFiles",
  "listAllBucketNames",
  "readBucketRetentions",
  "writeBucketRetentions",
  "writeFileLegalHolds",
  "shareFiles",
  "writeFiles",
  "listKeys",
  "listBuckets",
  "listFiles",
  "writeFileRetentions",
  "writeBucketEncryption",
  "readFileRetentions",
];

export interface B2BucketRef {
  id: string;
  name: string;
}

export interface B2Bucket extends B2BucketRef {
  bucketId: string;
  bucketName: string;
  accountId: string;
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
  accountId: string;
  storage: B2StorageApiInfo;
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
