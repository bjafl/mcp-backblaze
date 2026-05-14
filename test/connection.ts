import "dotenv/config";
import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { authorize, listBuckets, listFiles } from "../src/b2client.js";
import type { B2Bucket } from "../src/types.js";

const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");

const PASS = "✓";
const FAIL = "✗";
const INFO = "·";
const REQ  = "→";
const RES  = "←";

let failures = 0;

function ok(label: string, detail?: string): void {
  console.log(`  ${PASS} ${label}${detail ? `  (${detail})` : ""}`);
}

function fail(label: string, err: unknown): void {
  failures++;
  if (err instanceof AxiosError) {
    const status = err.response?.status ?? "no response";
    const data = err.response?.data as { code?: string; message?: string } | undefined;
    console.log(`  ${FAIL} ${label}`);
    console.log(`       HTTP ${status}  code=${data?.code ?? "—"}  message=${data?.message ?? err.message}`);
    if (verbose && err.response) {
      console.log(`       Headers: ${JSON.stringify(err.response.headers)}`);
      console.log(`       Body:    ${JSON.stringify(err.response.data, null, 2)}`);
    }
  } else {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ${FAIL} ${label}: ${msg}`);
  }
}

function info(msg: string): void {
  console.log(`  ${INFO} ${msg}`);
}

function section(title: string): void {
  console.log(`\n${title}`);
  console.log("─".repeat(title.length));
}

function maskAuth(value: string): string {
  if (value.startsWith("Basic ")) return `Basic ${value.slice(6, 12)}…[masked]`;
  return `${value.slice(0, 8)}…[masked]`;
}

// ── Verbose axios interceptors ────────────────────────────────────────────────

if (verbose) {
  axios.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const method = config.method?.toUpperCase() ?? "?";
    const url = axios.getUri(config);
    console.log(`\n    ${REQ} ${method} ${url}`);
    if (config.params) console.log(`       Params:  ${JSON.stringify(config.params)}`);
    const auth = config.headers?.Authorization as string | undefined;
    if (auth) console.log(`       Auth:    ${maskAuth(auth)}`);
    if (config.data && typeof config.data === "string") {
      console.log(`       Body:    ${config.data.slice(0, 200)}`);
    } else if (config.data && Buffer.isBuffer(config.data)) {
      console.log(`       Body:    <Buffer ${config.data.length} bytes>`);
    } else if (config.data) {
      console.log(`       Body:    ${JSON.stringify(config.data).slice(0, 200)}`);
    }
    return config;
  });

  axios.interceptors.response.use(
    (response) => {
      console.log(`    ${RES} ${response.status} ${response.statusText}`);
      const body = JSON.stringify(response.data, null, 2);
      const truncated = body.length > 800 ? `${body.slice(0, 800)}\n       …(truncated)` : body;
      console.log(`       Body:    ${truncated.replace(/\n/g, "\n       ")}`);
      return response;
    },
    (error: AxiosError) => {
      console.log(`    ${RES} ${error.response?.status ?? "ERR"} ${error.response?.statusText ?? error.code}`);
      if (error.response?.data) {
        console.log(`       Body:    ${JSON.stringify(error.response.data)}`);
      }
      return Promise.reject(error);
    },
  );
}

// ── Check env vars ────────────────────────────────────────────────────────────

section("Environment");

const keyId = process.env.B2_APPLICATION_KEY_ID;
const key = process.env.B2_APPLICATION_KEY;

if (keyId) {
  ok("B2_APPLICATION_KEY_ID", `${keyId.slice(0, 6)}…`);
} else {
  fail("B2_APPLICATION_KEY_ID", new Error("not set — copy .env.example to .env and fill in credentials"));
}

if (key) {
  ok("B2_APPLICATION_KEY", `${key.slice(0, 4)}…`);
} else {
  fail("B2_APPLICATION_KEY", new Error("not set"));
}

if (failures > 0) {
  console.log("\nAborting — missing credentials.\n");
  process.exit(1);
}

// ── Authentication ────────────────────────────────────────────────────────────

section("Authentication");

let auth;
try {
  auth = await authorize();
  ok("b2_authorize_account", `accountId=${auth.accountId}`);
  info(`API URL:      ${auth.apiUrl}`);
  info(`Download URL: ${auth.downloadUrl}`);
} catch (err) {
  fail("b2_authorize_account", err);
  console.log("\nAborting — cannot authenticate.\n");
  process.exit(1);
}

// ── Buckets ───────────────────────────────────────────────────────────────────

section("Buckets");

let buckets: B2Bucket[] = [];
try {
  buckets = await listBuckets();
  ok(`b2_list_buckets`, `${buckets.length} bucket(s) found`);
  for (const b of buckets) {
    info(`${b.bucketName}  [${b.bucketType}]  id=${b.bucketId}`);
  }
} catch (err) {
  fail("b2_list_buckets", err);
}

// ── Files ─────────────────────────────────────────────────────────────────────

if (buckets.length > 0) {
  section("Files");

  for (const bucket of buckets) {
    try {
      const result = await listFiles(bucket.bucketId, undefined, 10);
      const count = result.files.length;
      const more = result.nextFileName !== null ? " (more available)" : "";
      ok(`b2_list_file_names — ${bucket.bucketName}`, `${count} file(s)${more}`);
      for (const f of result.files) {
        const kb = (f.contentLength / 1024).toFixed(1);
        info(`  ${f.fileName}  (${kb} KB)`);
      }
      if (count === 0) {
        info("  (bucket is empty)");
      }
    } catch (err) {
      fail(`b2_list_file_names — ${bucket.bucketName}`, err);
    }
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log("");
if (failures === 0) {
  console.log(`All checks passed.\n`);
} else {
  console.log(`${failures} check(s) failed.\n`);
  process.exit(1);
}
