// Type definitions for environment variables
declare global {
	interface Env {
		// KV namespace for OAuth state
		OAUTH_KV: KVNamespace;

		// Durable Object for MCP
		MCP_OBJECT: DurableObjectNamespace;

		// Google OAuth credentials
		GOOGLE_CLIENT_ID: string;
		GOOGLE_CLIENT_SECRET: string;

		// Encryption key for cookies
		COOKIE_ENCRYPTION_KEY: string;

		// Optional: restrict to specific Google Workspace domain
		HOSTED_DOMAIN?: string;

		// API Key authentication (comma-separated list)
		ALLOWED_API_KEYS?: string;
	}
}

export {};
