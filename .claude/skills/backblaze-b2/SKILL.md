---
name: backblaze-b2
description: Reference guide for the Backblaze B2 Native API (v4). Use when building integrations, MCP servers, or tools that interact with Backblaze B2 Cloud Storage — covers authentication, bucket management, file upload/download/delete, and error handling.
source: https://www.backblaze.com/apidocs/introduction-to-the-b2-native-api
---

# Backblaze B2 Native API — Reference Guide

## Overview

The B2 Native API (v4) provides access to Backblaze B2 Cloud Storage. Operations: upload, download, and delete files; create and manage buckets; configure account settings.

**Base URL:** Returned by `b2_authorize_account` — format `https://apiNNN.backblazeb2.com`  
**Download URL:** Also returned by `b2_authorize_account` — format `https://fNNN.backblazeb2.com`  
**API version prefix:** `/b2api/v4/`  
**IPv6:** Only supported via the S3-compatible API, not the native API.

---

## Authentication

### Step 1 — Authorize Account

**Endpoint:** `GET https://api.backblazeb2.com/b2api/v4/b2_authorize_account`

**Auth:** HTTP Basic — Base64-encode `applicationKeyId:applicationKey` and prefix with `Basic `.

```
Authorization: Basic base64(applicationKeyId:applicationKey)
```

**Response (200):**
```json
{
  "accountId": "YOUR_ACCOUNT_ID",
  "authorizationToken": "...",
  "applicationKeyExpirationTimestamp": null,
  "apiInfo": {
    "storageApi": {
      "apiUrl": "https://apiNNN.backblazeb2.com",
      "downloadUrl": "https://fNNN.backblazeb2.com",
      "s3ApiUrl": "https://s3.us-west-NNN.backblazeb2.com",
      "absoluteMinimumPartSize": 5242880,
      "recommendedPartSize": 104857600,
      "allowed": {
        "buckets": [],
        "capabilities": ["listBuckets", "readFiles", "writeFiles", ...],
        "namePrefix": null
      }
    }
  }
}
```

**Key rules:**
- `authorizationToken` is valid for up to 24 hours — cache it, don't re-authorize per request.
- Use `apiInfo.storageApi.apiUrl` as base for all subsequent API calls.
- Use `apiInfo.storageApi.downloadUrl` for file downloads.
- `allowed.capabilities` lists what this key can do — check before calling endpoints.

**Errors:**
| Status | Code | Meaning |
|--------|------|---------|
| 400 | `bad_request` | Invalid fields |
| 401 | `unauthorized` | Invalid credentials |
| 401 | `unsupported` | Key incompatible with API v4 |
| 403 | `transaction_cap_exceeded` | Daily limit exceeded |

---

## Bucket Operations

### Create Bucket

**Endpoint:** `POST /b2api/v4/b2_create_bucket`  
**Required capability:** `writeBuckets`

**Request body (JSON):**
```json
{
  "accountId": "YOUR_ACCOUNT_ID",
  "bucketName": "my-bucket-name",
  "bucketType": "allPrivate"
}
```

- `bucketName`: 6–63 chars, alphanumeric + hyphens, globally unique, cannot start with `b2-`
- `bucketType`: `"allPublic"` or `"allPrivate"`
- Optional: `bucketInfo` (object), `corsRules` (array), `lifecycleRules` (array), `fileLockEnabled` (boolean), `defaultServerSideEncryption` (object)

**Response (200):** Returns full bucket object (see List Buckets for schema).

**Errors:**
| Status | Code | Meaning |
|--------|------|---------|
| 400 | `too_many_buckets` | Account at 100-bucket limit |
| 400 | `duplicate_bucket_name` | Name already in use |
| 401 | `unauthorized` | Missing `writeBuckets` capability |

### List Buckets

**Endpoint:** `POST /b2api/v4/b2_list_buckets`  
**Required capability:** `listBuckets`

**Request body (JSON):**
```json
{
  "accountId": "YOUR_ACCOUNT_ID",
  "bucketId": "optional-filter",
  "bucketName": "optional-filter",
  "bucketTypes": ["allPrivate", "allPublic"]
}
```

**Response (200):**
```json
{
  "buckets": [
    {
      "accountId": "...",
      "bucketId": "4a48fe8875c6214145260818",
      "bucketName": "my-bucket",
      "bucketType": "allPrivate",
      "bucketInfo": {},
      "corsRules": [],
      "fileLockConfiguration": {},
      "defaultServerSideEncryption": {},
      "lifecycleRules": [],
      "replicationConfiguration": {},
      "revision": 3,
      "options": ["s3"]
    }
  ]
}
```

---

## File Operations

### Upload File (single, ≤ ~5 GB)

Upload requires two steps: get an upload URL, then POST the file.

#### Step 1 — Get Upload URL

**Endpoint:** `GET /b2api/v4/b2_get_upload_url?bucketId=BUCKET_ID`  
**Required capability:** `writeFiles`

**Response (200):**
```json
{
  "bucketId": "4a48fe8875c6214145260818",
  "uploadUrl": "https://pod-000-1005-03.backblaze.com/b2api/v4/b2_upload_file?...",
  "authorizationToken": "upload-token-here"
}
```

- `uploadUrl` and `authorizationToken` are used together for the actual upload.
- Upload tokens are single-use — get a new one after each upload or on 503 error.

#### Step 2 — Upload File

**Endpoint:** `POST {uploadUrl}` (from step 1)

**Required headers:**
| Header | Description |
|--------|-------------|
| `Authorization` | Upload token from step 1 |
| `X-Bz-File-Name` | Percent-encoded UTF-8 filename |
| `Content-Type` | MIME type, or `b2/x-auto` for auto-detection |
| `Content-Length` | File size in bytes (chunked encoding not supported) |
| `X-Bz-Content-Sha1` | SHA1 of file content (hex), or `hex_digits_at_end` to append after body |

**Optional headers:**
- `X-Bz-Info-src_last_modified_millis`: Source modification time (ms since epoch)
- `X-Bz-Info-b2-content-disposition`: Content-Disposition on download
- `X-Bz-Info-*`: Custom metadata (any key prefixed with `X-Bz-Info-`)
- `X-Bz-Server-Side-Encryption`: `AES256` for SSE-B2
- `X-Bz-File-Legal-Hold`: `on` or `off`
- `X-Bz-File-Retention-Mode`: `governance` or `compliance`

**Request body:** Raw file bytes.

**Response (200):**
```json
{
  "accountId": "...",
  "action": "upload",
  "bucketId": "4a48fe8875c6214145260818",
  "contentLength": 7,
  "contentSha1": "dc724af18fbdd4e59189f5fe768a5f8311527050",
  "contentMd5": "...",
  "contentType": "text/plain",
  "fileId": "4_z...",
  "fileInfo": {},
  "fileName": "myfile.txt",
  "uploadTimestamp": 1536964279000,
  "serverSideEncryption": { "mode": "none" }
}
```

**Upload errors:**
| Status | Code | Action |
|--------|------|--------|
| 400 | `auth_token_limit` | Token already in use — use separate tokens for parallel uploads |
| 503 | `service_unavailable` | Get a new upload URL and retry |
| 408 | `request_timeout` | Retry with new upload URL |

### Download File by Name

**Endpoint:** `GET /file/{BUCKET_NAME}/{FILE_NAME}`  
**Host:** `{downloadUrl}` from `b2_authorize_account`

```
GET https://fNNN.backblazeb2.com/file/my-bucket/path/to/file.jpg
Authorization: <authorizationToken>
```

- No `Authorization` header needed for `allPublic` buckets.
- Use `Range: bytes=0-99` header for partial/range downloads — returns 206.
- Override response headers via query params: `b2ContentDisposition`, `b2ContentType`, `b2CacheControl`, etc.

**Response headers include:**
- `X-Bz-File-Id`, `X-Bz-File-Name`, `X-Bz-Content-Sha1`, `X-Bz-Upload-Timestamp`
- `X-Bz-Info-*` for custom metadata

**Errors:**
| Status | Code | Meaning |
|--------|------|---------|
| 401 | `unauthorized` | Missing/invalid token for private bucket |
| 404 | (none) | File not found |
| 416 | (none) | Range not satisfiable |

### List File Names

**Endpoint:** `GET /b2api/v4/b2_list_file_names`  
**Required capability:** `listFiles`

**Query parameters:**
| Param | Required | Description |
|-------|----------|-------------|
| `bucketId` | Yes | Target bucket |
| `startFileName` | No | Pagination cursor |
| `maxFileCount` | No | Default 100, max 10,000 |
| `prefix` | No | Filter by filename prefix |
| `delimiter` | No | Virtual folder separator (typically `/`) |

**Response (200):**
```json
{
  "files": [
    {
      "accountId": "...",
      "action": "upload",
      "bucketId": "...",
      "contentLength": 7,
      "contentSha1": "...",
      "contentType": "text/plain",
      "fileId": "4_z...",
      "fileName": "photos/cat.jpg",
      "fileInfo": {},
      "uploadTimestamp": 1536964279000,
      "serverSideEncryption": { "mode": "SSE-B2", "algorithm": "AES256" }
    }
  ],
  "nextFileName": "photos/dog.jpg"
}
```

- `action` values: `"upload"`, `"start"` (large file in progress), `"hide"` (deletion marker), `"folder"` (virtual folder when delimiter used)
- Paginate by passing `nextFileName` as `startFileName` in next request. Stop when `nextFileName` is `null`.
- Billing: 1 transaction per 1,000 files returned.

### Delete File Version

**Endpoint:** `POST /b2api/v4/b2_delete_file_version`  
**Required capability:** `deleteFiles`

**Request body (JSON):**
```json
{
  "fileName": "myfile.txt",
  "fileId": "4_z..."
}
```

**Response (200):**
```json
{
  "fileId": "4_z...",
  "fileName": "myfile.txt"
}
```

- Deletes a specific version. If it was the latest version, the next older version becomes current.
- Pass `"bypassGovernance": true` to delete Object Lock governance-protected versions (requires `bypassGovernance` capability).
- When called on an unfinished large file, behaves like `b2_cancel_large_file`.

**Errors:**
| Status | Code | Meaning |
|--------|------|---------|
| 400 | `file_not_present` | File version not found |
| 401 | `access_denied` | Object Lock prevents deletion |

---

## Large File Uploads (> 5 GB)

For files larger than ~5 GB, use the multipart upload flow:

1. `b2_start_large_file` — initiate, get `fileId`
2. `b2_get_upload_part_url` — get URL + token per part
3. `b2_upload_part` — upload each part (min 5 MB per part, except last); note SHA1 per part
4. `b2_finish_large_file` — finalize with array of part SHA1s

Or cancel with `b2_cancel_large_file`.

---

## Error Response Format

All errors return JSON:
```json
{
  "status": 401,
  "code": "unauthorized",
  "message": "The application key you provided is not authorized for this operation."
}
```

### Common Error Codes
| Status | Code | Typical Cause |
|--------|------|---------------|
| 400 | `bad_request` | Invalid parameter value or type |
| 400 | `bad_bucket_id` | Bucket ID doesn't exist |
| 401 | `bad_auth_token` | Token invalid or malformed |
| 401 | `expired_auth_token` | Token older than 24 hours |
| 401 | `unauthorized` | Token lacks required capability |
| 403 | `storage_cap_exceeded` | Storage limit reached |
| 403 | `transaction_cap_exceeded` | Daily transaction limit reached |
| 429 | `too_many_requests` | Rate limit — back off and retry |
| 503 | `service_unavailable` | Transient error — retry with exponential backoff |

---

## Capabilities Reference

Capabilities control what an application key can do. Common values:

| Capability | Required By |
|-----------|-------------|
| `listBuckets` | `b2_list_buckets` |
| `writeBuckets` | `b2_create_bucket`, `b2_update_bucket` |
| `deleteBuckets` | `b2_delete_bucket` |
| `listFiles` | `b2_list_file_names`, `b2_list_file_versions` |
| `readFiles` | Download files |
| `writeFiles` | `b2_get_upload_url`, `b2_upload_file` |
| `deleteFiles` | `b2_delete_file_version` |
| `bypassGovernance` | Delete Object Lock governance files |
| `readBucketEncryption` | Read SSE settings |
| `writeBucketEncryption` | Set SSE settings |
| `readFileRetentions` | Read Object Lock retention |
| `writeFileRetentions` | Set Object Lock retention |

---

## Key Conventions

- **File names** must be percent-encoded UTF-8. Path separators `/` create virtual folder structure.
- **SHA1 checksums** are required for uploads — compute before sending, or use `hex_digits_at_end` to append after body.
- **Timestamps** are always milliseconds since Unix epoch (not seconds).
- **POST vs GET:** Most endpoints accept both POST (JSON body) and GET (query params). Prefer POST for writes.
- **Token reuse:** `authorizationToken` from `b2_authorize_account` is reusable for up to 24h. Upload tokens from `b2_get_upload_url` are single-use.
- **Parallel uploads:** Use separate upload URLs (separate `b2_get_upload_url` calls) for concurrent uploads to the same bucket — tokens cannot be shared.
- **PHI/PII warning:** Do not put personal or health data in bucket names, file names, or metadata — these fields are not HIPAA-encrypted.

---

## Quick Reference — Endpoint Summary

| Operation | Method | Path |
|-----------|--------|------|
| Authorize | GET | `https://api.backblazeb2.com/b2api/v4/b2_authorize_account` |
| Create bucket | POST | `/b2api/v4/b2_create_bucket` |
| List buckets | POST | `/b2api/v4/b2_list_buckets` |
| Get upload URL | GET | `/b2api/v4/b2_get_upload_url` |
| Upload file | POST | `{uploadUrl}` (from get_upload_url) |
| Download by name | GET | `{downloadUrl}/file/{bucket}/{filename}` |
| List file names | GET | `/b2api/v4/b2_list_file_names` |
| Delete file version | POST | `/b2api/v4/b2_delete_file_version` |
| Get file info | GET | `/b2api/v4/b2_get_file_info` |
| Start large file | POST | `/b2api/v4/b2_start_large_file` |
| Get upload part URL | GET | `/b2api/v4/b2_get_upload_part_url` |
| Upload part | POST | `{uploadPartUrl}` (from get_upload_part_url) |
| Finish large file | POST | `/b2api/v4/b2_finish_large_file` |
| Cancel large file | POST | `/b2api/v4/b2_cancel_large_file` |
