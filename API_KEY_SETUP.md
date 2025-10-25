# API Key Authentication Setup

This MCP server **requires** an API Key to protect the MCP endpoints from unauthorized access. The server will not function without setting `ALLOWED_API_KEYS`.

## Overview

**What's protected:**
- `/mcp` endpoint (Streamable HTTP protocol)
- `/sse` endpoint (deprecated SSE protocol)

**What's NOT protected:**
- OAuth endpoints (`/authorize`, `/token`, `/register`, `/callback`)
- These must remain open for the OAuth flow to work

## Setup (Server Side)

### 1. Generate API Keys

Generate secure random keys for each user:

```bash
# Method 1: Using OpenSSL (recommended)
openssl rand -base64 32

# Method 2: Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Method 3: Using Python
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

### 2. Set the Secret in Cloudflare

```bash
# Set allowed API keys (comma-separated for multiple keys)
wrangler secret put ALLOWED_API_KEYS

# Example input:
# abc123xyz456,def789ghi012,jkl345mno678
```

**Important:** Keys are comma-separated. Each key should be unique per user/team.

### 3. Deploy

```bash
wrangler deploy
```

## Usage (Client Side)

### For Claude Desktop

Edit your `claude_desktop_config.json`:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "gdrive": {
      "command": "npx",
      "args": [
        "mcp-remote@latest",
        "https://your-worker.workers.dev/mcp",
        "--header",
        "X-API-Key: ${GDRIVE_API_KEY}"
      ],
      "env": {
        "GDRIVE_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

**Windows Workaround** (if spaces cause issues):
```json
{
  "mcpServers": {
    "gdrive": {
      "command": "npx",
      "args": [
        "mcp-remote@latest",
        "https://your-worker.workers.dev/mcp",
        "--header",
        "X-API-Key:${GDRIVE_API_KEY}"
      ],
      "env": {
        "GDRIVE_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

### For Claude Code CLI

```bash
claude mcp add \
  --transport http \
  gdrive \
  https://your-worker.workers.dev/mcp \
  --header "X-API-Key: your-api-key-here"
```

### For MCP Inspector (Testing)

```bash
npx @modelcontextprotocol/inspector@latest
```

When connecting, you'll need to manually add the header in your HTTP client or use:

```bash
curl -X POST https://your-worker.workers.dev/mcp \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{},"id":1}'
```

## Security Best Practices

1. **Never commit API keys to git**
   - Use environment variables
   - Add `.env` to `.gitignore`

2. **Use different keys for different users**
   - Easier to revoke individual access
   - Better audit trail

3. **Rotate keys regularly**
   ```bash
   # Generate new key
   openssl rand -base64 32

   # Update secret
   wrangler secret put ALLOWED_API_KEYS

   # Notify users to update their config
   ```

4. **Monitor usage**
   - Check Cloudflare Analytics
   - Set up usage alerts in Cloudflare Dashboard

5. **Share keys securely**
   - Use password managers (1Password, Bitwarden)
   - Use encrypted channels (Signal, encrypted email)
   - Never send via plain text email or Slack

## Troubleshooting

### Error: "Unauthorized - Valid X-API-Key header is required"

**Cause:** Missing or invalid API key

**Solutions:**
1. Check that `X-API-Key` header is being sent
2. Verify the key matches one in `ALLOWED_API_KEYS`
3. Check for extra spaces in the key
4. Ensure you're using the correct header name (case-sensitive)

### Error: OAuth flow not working

**Cause:** API Key might be blocking OAuth endpoints (shouldn't happen)

**Check:** OAuth endpoints (`/authorize`, `/token`, `/callback`) should NOT require API Key

### Key Management

**To add a new key without disrupting existing users:**
```bash
# Current keys: key1,key2
# New secret value: key1,key2,key3
wrangler secret put ALLOWED_API_KEYS
```

**To revoke a key:**
```bash
# Remove the key from the comma-separated list
wrangler secret put ALLOWED_API_KEYS
```

## Backward Compatibility

If `ALLOWED_API_KEYS` is not set, the server will allow all connections (no API key required). This ensures backward compatibility with existing deployments.

To enable API key protection, simply set the `ALLOWED_API_KEYS` secret.

## Cost Impact

Adding API Key authentication has **minimal cost impact**:
- No additional KV reads/writes
- No additional Durable Object invocations
- Only adds ~1ms to request processing time
- Works within free tier limits
