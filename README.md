# Backblaze B2 MCP Server

MCP server for Backblaze B2 Cloud Storage. Provides tools for listing buckets, managing files, and uploading/downloading content.

## Setup

### 1. Build

```bash
npm install
npm run build
```

### 2. Environment variables

```bash
export B2_APPLICATION_KEY_ID=your_key_id
export B2_APPLICATION_KEY=your_application_key
```

Create an application key in the Backblaze web console under **Account → App Keys**.

### 3. MCP config json

```json
{
  "mcpServers": {
    "backblaze-b2": {
      "command": "node",
      "args": ["-y", "github:bjafl/mcp-backblaze"],
      "env": {
        "B2_APPLICATION_KEY_ID": "your_key_id",
        "B2_APPLICATION_KEY": "your_application_key"
      }
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `b2_list_buckets` | List all buckets in the account |
| `b2_list_files` | List files in a bucket with prefix filtering and pagination |
| `b2_upload_file` | Upload a local file to a bucket |
| `b2_download_file` | Download a file (save to disk or return as text) |
| `b2_delete_file` | Delete a specific file version |
| `b2_get_file_info` | Get metadata for a file version |

## Required capabilities

The application key must have the capabilities matching the tools you use:

- `listBuckets` — b2_list_buckets
- `listFiles` — b2_list_files
- `readFiles` — b2_download_file
- `writeFiles` — b2_upload_file
- `deleteFiles` — b2_delete_file
