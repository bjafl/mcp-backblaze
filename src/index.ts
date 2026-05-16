#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { writeFileSync } from "node:fs";
import { basename } from "node:path";
import * as b2 from "./b2client.js";

const CHARACTER_LIMIT = 25000;

enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}

function toRecord(obj: object): Record<string, unknown> {
  return JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

const server = new McpServer({
  name: "backblaze-b2-mcp-server",
  version: "1.0.0",
});

// ── b2_list_buckets ──────────────────────────────────────────────────────────

server.registerTool(
  "b2_list_buckets",
  {
    title: "List B2 Buckets",
    description: `Lists all Backblaze B2 buckets in the account.

Returns bucket names, IDs, types (allPublic/allPrivate), and options.

Args:
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  List of buckets with bucketId, bucketName, bucketType, and options.`,
    inputSchema: z
      .object({
        response_format: z
          .nativeEnum(ResponseFormat)
          .default(ResponseFormat.MARKDOWN)
          .describe(
            "Output format: 'markdown' for human-readable, 'json' for machine-readable",
          ),
      })
      .strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ response_format }) => {
    try {
      const buckets = await b2.listBuckets();

      if (response_format === ResponseFormat.JSON) {
        return {
          content: [{ type: "text", text: JSON.stringify(buckets, null, 2) }],
          structuredContent: { buckets },
        };
      }

      const lines = [`# B2 Buckets (${buckets.length})`, ""];
      for (const bucket of buckets) {
        lines.push(`## ${bucket.bucketName}`);
        lines.push(`- **ID**: \`${bucket.bucketId}\``);
        lines.push(`- **Type**: ${bucket.bucketType}`);
        if (bucket.options?.length)
          lines.push(`- **Options**: ${bucket.options.join(", ")}`);
        lines.push("");
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (error) {
      return { content: [{ type: "text", text: b2.handleApiError(error) }] };
    }
  },
);

// ── b2_list_files ────────────────────────────────────────────────────────────

server.registerTool(
  "b2_list_files",
  {
    title: "List Files in B2 Bucket",
    description: `Lists files in a Backblaze B2 bucket with optional prefix filtering and pagination.

Args:
  - bucket_id (string): ID of the bucket (from b2_list_buckets)
  - prefix (string, optional): Filter files by name prefix (e.g., 'photos/')
  - max_count (number): Max files to return, 1–1000 (default: 100)
  - start_file_name (string, optional): Pagination cursor — nextFileName from previous response
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  {
    "files": [{ "fileName", "fileId", "contentLength", "contentType", "uploadTimestamp", "action" }],
    "next_file_name": string | null,
    "has_more": boolean
  }

Notes:
  - Use prefix='folder/' and delimiter='/' to browse virtual folders
  - Pass next_file_name as start_file_name to paginate`,
    inputSchema: z
      .object({
        bucket_id: z.string().describe("Bucket ID (from b2_list_buckets)"),
        prefix: z
          .string()
          .optional()
          .describe("Filter by name prefix (e.g., 'photos/')"),
        max_count: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .default(100)
          .describe("Max files to return (default: 100, max: 1000)"),
        start_file_name: z
          .string()
          .optional()
          .describe("Pagination cursor: nextFileName from previous response"),
        response_format: z
          .nativeEnum(ResponseFormat)
          .default(ResponseFormat.MARKDOWN)
          .describe(
            "Output format: 'markdown' for human-readable, 'json' for machine-readable",
          ),
      })
      .strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({
    bucket_id,
    prefix,
    max_count,
    start_file_name,
    response_format,
  }) => {
    try {
      const result = await b2.listFiles(
        bucket_id,
        prefix,
        max_count,
        start_file_name,
      );
      const hasMore = result.nextFileName !== null;

      const output = {
        files: result.files.map((f) => ({
          fileName: f.fileName,
          fileId: f.fileId,
          contentLength: f.contentLength,
          contentType: f.contentType,
          uploadTimestamp: f.uploadTimestamp,
          action: f.action,
        })),
        next_file_name: result.nextFileName,
        has_more: hasMore,
      };

      if (response_format === ResponseFormat.JSON) {
        const text = JSON.stringify(output, null, 2);
        return {
          content: [
            {
              type: "text",
              text:
                text.length > CHARACTER_LIMIT
                  ? `${text.slice(0, CHARACTER_LIMIT)}\n...(truncated)`
                  : text,
            },
          ],
          structuredContent: output,
        };
      }

      const lines = [`# Files in Bucket`, ""];
      if (prefix) lines.push(`**Prefix**: \`${prefix}\``, "");
      lines.push(
        `Found **${result.files.length}** file(s)${hasMore ? " (more available — paginate with next_file_name)" : ""}`,
        "",
      );

      for (const f of result.files) {
        const date = new Date(f.uploadTimestamp)
          .toISOString()
          .replace("T", " ")
          .slice(0, 19);
        const size = formatBytes(f.contentLength);
        lines.push(`- **${f.fileName}**`);
        lines.push(`  ${size} · ${f.contentType ?? "unknown"} · ${date}`);
        lines.push(`  ID: \`${f.fileId}\``);
      }

      if (hasMore) {
        lines.push(
          "",
          `*Next page: \`start_file_name: "${result.nextFileName}"\`*`,
        );
      }

      const text = lines.join("\n");
      return {
        content: [
          {
            type: "text",
            text:
              text.length > CHARACTER_LIMIT
                ? `${text.slice(0, CHARACTER_LIMIT)}\n...(truncated)`
                : text,
          },
        ],
      };
    } catch (error) {
      return { content: [{ type: "text", text: b2.handleApiError(error) }] };
    }
  },
);

// ── b2_upload_file ───────────────────────────────────────────────────────────

server.registerTool(
  "b2_upload_file",
  {
    title: "Upload File to B2",
    description: `Uploads a local file to a Backblaze B2 bucket.

Args:
  - bucket_id (string): ID of the destination bucket (from b2_list_buckets)
  - local_path (string): Absolute path to the local file to upload
  - remote_name (string, optional): File name in B2. Defaults to the basename of local_path. Use '/' as virtual folder separator (e.g., 'photos/cat.jpg')
  - content_type (string, optional): MIME type. Defaults to 'b2/x-auto' for auto-detection

Returns:
  Upload result with fileId, fileName, contentLength, contentSha1, and uploadTimestamp.

Notes:
  - Max file size: ~5 GB (larger files require multipart upload, not supported here)
  - local_path must be accessible from the server's filesystem`,
    inputSchema: z
      .object({
        bucket_id: z
          .string()
          .describe("ID of the destination bucket (from b2_list_buckets)"),
        local_path: z.string().describe("Absolute local file path to upload"),
        remote_name: z
          .string()
          .optional()
          .describe(
            "File name in B2 (default: basename of local_path). Use '/' for virtual folders",
          ),
        content_type: z
          .string()
          .optional()
          .describe("MIME type (default: 'b2/x-auto' for auto-detection)"),
      })
      .strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ bucket_id, local_path, remote_name, content_type }) => {
    try {
      const fileName = remote_name ?? basename(local_path);
      const result = await b2.uploadFile(
        bucket_id,
        fileName,
        local_path,
        content_type ?? "b2/x-auto",
      );

      const text = [
        "# Upload Successful",
        "",
        `- **File**: ${result.fileName}`,
        `- **ID**: \`${result.fileId}\``,
        `- **Size**: ${formatBytes(result.contentLength)}`,
        `- **SHA1**: ${result.contentSha1}`,
        `- **Uploaded**: ${new Date(result.uploadTimestamp).toISOString()}`,
      ].join("\n");

      return {
        content: [{ type: "text", text }],
        structuredContent: toRecord(result),
      };
    } catch (error) {
      return { content: [{ type: "text", text: b2.handleApiError(error) }] };
    }
  },
);

// ── b2_upload_content ────────────────────────────────────────────────────────

server.registerTool(
  "b2_upload_content",
  {
    title: "Upload Content to B2",
    description: `Uploads inline content (text or base64) to a Backblaze B2 bucket without needing a local file on the server's filesystem.

Use this tool when you have file content in memory (e.g., a generated markdown note).
Use b2_upload_file instead when uploading an existing file already on the MCP server's filesystem.

Args:
  - bucket_id (string): Destination bucket ID (from b2_list_buckets)
  - remote_name (string): File name in B2. Use '/' for virtual folders (e.g., 'Oppskrifter/recipe.md')
  - content (string): File contents. UTF-8 text by default; base64-encoded bytes when encoding='base64'
  - encoding ('utf-8' | 'base64'): Content encoding (default: 'utf-8')
  - content_type (string, optional): MIME type (default: 'b2/x-auto' for auto-detection)

Returns:
  Upload result with fileId, fileName, contentLength, contentSha1, and uploadTimestamp.`,
    inputSchema: z.object({
      bucket_id: z.string().describe("Destination bucket ID (from b2_list_buckets)"),
      remote_name: z
        .string()
        .describe(
          "File name in B2. Use '/' for virtual folders (e.g., 'Oppskrifter/recipe.md')",
        ),
      content: z
        .string()
        .describe(
          "File contents as a string. UTF-8 text by default; base64-encoded for binary files",
        ),
      encoding: z
        .enum(["utf-8", "base64"])
        .default("utf-8")
        .describe(
          "Content encoding: 'utf-8' for text files (default), 'base64' for binary",
        ),
      content_type: z
        .string()
        .optional()
        .describe("MIME type (default: 'b2/x-auto' for auto-detection)"),
    }).strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ bucket_id, remote_name, content, encoding, content_type }) => {
    try {
      const result = await b2.uploadContent(
        bucket_id,
        remote_name,
        content,
        encoding,
        content_type ?? "b2/x-auto",
      );

      const text = [
        "# Upload Successful",
        "",
        `- **File**: ${result.fileName}`,
        `- **ID**: \`${result.fileId}\``,
        `- **Size**: ${formatBytes(result.contentLength)}`,
        `- **SHA1**: ${result.contentSha1}`,
        `- **Uploaded**: ${new Date(result.uploadTimestamp).toISOString()}`,
      ].join("\n");

      return {
        content: [{ type: "text", text }],
        structuredContent: toRecord(result),
      };
    } catch (error) {
      return { content: [{ type: "text", text: b2.handleApiError(error) }] };
    }
  },
);

// ── b2_get_upload_url ────────────────────────────────────────────────────────

server.registerTool(
  "b2_get_upload_url",
  {
    title: "Get B2 Upload URL",
    description: `Gets a one-time upload URL and authorization token for direct client-side uploads to a Backblaze B2 bucket.

Use this when the caller will perform the upload itself (e.g., uploading large files directly from a client without routing content through this server). For small files or generated content, use b2_upload_content instead.

Args:
  - bucket_id (string): Destination bucket ID (from b2_list_buckets)

Returns:
  {
    "uploadUrl": string,       // POST target for the upload
    "authorizationToken": string,  // Value for the Authorization header
    "bucketId": string
  }

Notes:
  - The upload URL is single-use and expires after ~24 hours or on first use.
  - The caller must set these headers on the upload POST:
      Authorization: <authorizationToken>
      X-Bz-File-Name: <percent-encoded filename>
      Content-Type: <mime type or 'b2/x-auto'>
      Content-Length: <byte length>
      X-Bz-Content-Sha1: <hex sha1 of file bytes>`,
    inputSchema: z.object({
      bucket_id: z.string().describe("Destination bucket ID (from b2_list_buckets)"),
    }).strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ bucket_id }) => {
    try {
      const result = await b2.getUploadUrl(bucket_id);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: toRecord(result),
      };
    } catch (error) {
      return { content: [{ type: "text", text: b2.handleApiError(error) }] };
    }
  },
);

// ── b2_download_file ─────────────────────────────────────────────────────────

server.registerTool(
  "b2_download_file",
  {
    title: "Download File from B2",
    description: `Downloads a file from a Backblaze B2 bucket.

Args:
  - bucket_name (string): Name of the source bucket (use bucket name, not ID)
  - file_name (string): File path in B2 (e.g., 'photos/cat.jpg')
  - save_path (string, optional): Absolute local path to save the file. If omitted, returns file content as text (only suitable for text files)

Returns:
  If save_path is provided: Confirmation message with file size.
  If no save_path: File content as text (binary files will be garbled — use save_path for binary).`,
    inputSchema: z
      .object({
        bucket_name: z
          .string()
          .describe("Name of the source bucket (not the ID)"),
        file_name: z
          .string()
          .describe("File path in B2 (e.g., 'photos/cat.jpg')"),
        save_path: z
          .string()
          .optional()
          .describe(
            "Absolute local path to save the file. If omitted, returns content as text",
          ),
      })
      .strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ bucket_name, file_name, save_path }) => {
    try {
      const buffer = await b2.downloadFile(bucket_name, file_name);

      if (save_path) {
        writeFileSync(save_path, buffer);
        return {
          content: [
            {
              type: "text",
              text: `Downloaded \`${file_name}\` to \`${save_path}\` (${formatBytes(buffer.length)})`,
            },
          ],
        };
      }

      const text = buffer.toString("utf-8");
      const truncated =
        text.length > CHARACTER_LIMIT
          ? `${text.slice(0, CHARACTER_LIMIT)}\n...(truncated — use save_path to save full file)`
          : text;
      return { content: [{ type: "text", text: truncated }] };
    } catch (error) {
      return { content: [{ type: "text", text: b2.handleApiError(error) }] };
    }
  },
);

// ── b2_delete_file ───────────────────────────────────────────────────────────

server.registerTool(
  "b2_delete_file",
  {
    title: "Delete File from B2",
    description: `Deletes a specific file version from Backblaze B2. Both fileName and fileId are required.

Use b2_list_files to get the fileId before calling this tool.

Args:
  - file_name (string): Name of the file in B2 (as returned by b2_list_files)
  - file_id (string): Unique version ID (from b2_list_files or b2_upload_file response)

Returns:
  Confirmation with fileId and fileName of the deleted version.

Warning:
  This permanently deletes the file version. If it was the latest version and older versions exist, the next older version becomes current.`,
    inputSchema: z
      .object({
        file_name: z.string().describe("File name in B2 (from b2_list_files)"),
        file_id: z
          .string()
          .describe("File version ID (from b2_list_files or b2_upload_file)"),
      })
      .strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ file_name, file_id }) => {
    try {
      const result = await b2.deleteFile(file_name, file_id);
      return {
        content: [
          {
            type: "text",
            text: `Deleted \`${result.fileName}\` (ID: \`${result.fileId}\`)`,
          },
        ],
        structuredContent: toRecord(result),
      };
    } catch (error) {
      return { content: [{ type: "text", text: b2.handleApiError(error) }] };
    }
  },
);

// ── b2_get_file_info ─────────────────────────────────────────────────────────

server.registerTool(
  "b2_get_file_info",
  {
    title: "Get B2 File Info",
    description: `Gets metadata for a specific file version in Backblaze B2.

Args:
  - file_id (string): Unique file version ID (from b2_list_files or b2_upload_file)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  File metadata:
  {
    "fileName": string,
    "fileId": string,
    "contentType": string,
    "contentLength": number,
    "contentSha1": string,
    "uploadTimestamp": number,
    "action": string,
    "fileInfo": object  // custom metadata
  }`,
    inputSchema: z
      .object({
        file_id: z
          .string()
          .describe("File version ID (from b2_list_files or b2_upload_file)"),
        response_format: z
          .nativeEnum(ResponseFormat)
          .default(ResponseFormat.MARKDOWN)
          .describe(
            "Output format: 'markdown' for human-readable, 'json' for machine-readable",
          ),
      })
      .strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ file_id, response_format }) => {
    try {
      const info = await b2.getFileInfo(file_id);

      if (response_format === ResponseFormat.JSON) {
        return {
          content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
          structuredContent: toRecord(info),
        };
      }

      const lines = [
        "# File Info",
        "",
        `- **Name**: ${info.fileName}`,
        `- **ID**: \`${info.fileId}\``,
        `- **Type**: ${info.contentType}`,
        `- **Size**: ${formatBytes(info.contentLength)}`,
        `- **SHA1**: ${info.contentSha1}`,
        `- **Uploaded**: ${new Date(info.uploadTimestamp).toISOString()}`,
        `- **Action**: ${info.action}`,
      ];
      if (info.fileInfo && Object.keys(info.fileInfo).length > 0) {
        lines.push("", "**Custom metadata:**");
        for (const [k, v] of Object.entries(info.fileInfo)) {
          lines.push(`- ${k}: ${v}`);
        }
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (error) {
      return { content: [{ type: "text", text: b2.handleApiError(error) }] };
    }
  },
);

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!process.env.B2_APPLICATION_KEY_ID || !process.env.B2_APPLICATION_KEY) {
    console.error(
      "ERROR: B2_APPLICATION_KEY_ID and B2_APPLICATION_KEY environment variables are required",
    );
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.info("Backblaze B2 MCP server running via stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
