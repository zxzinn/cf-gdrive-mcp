import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { GoogleHandler } from "./google-handler";
import "./env";

// Context from the auth process, encrypted & stored in the auth token
// and provided to the MyMCP as this.props
type Props = {
	name: string;
	email: string;
	accessToken: string;
};

export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
	server = new McpServer({
		name: "Google Drive MCP",
		version: "1.0.0",
	});

	async init() {
		// 1. List files in Drive
		this.server.tool(
			"list_files",
			{
				folderId: z
					.string()
					.optional()
					.describe("Folder ID to list files from. If not provided, lists from root or all accessible files."),
				pageSize: z.number().default(100).describe("Number of files to return (max 1000)"),
				query: z.string().optional().describe("Google Drive query string (e.g., \"mimeType='image/jpeg'\")"),
			},
			async ({ folderId, pageSize, query }) => {
				let url = `https://www.googleapis.com/drive/v3/files?pageSize=${pageSize}`;

				if (query) {
					url += `&q=${encodeURIComponent(query)}`;
				} else if (folderId) {
					url += `&q=${encodeURIComponent(`'${folderId}' in parents`)}`;
				}

				url += "&fields=files(id,name,mimeType,size,createdTime,modifiedTime,webViewLink,parents)";

				const response = await fetch(url, {
					headers: { Authorization: `Bearer ${this.props.accessToken}` },
				});

				if (!response.ok) {
					const error = await response.text();
					return { content: [{ type: "text", text: `Error: ${response.status} - ${error}` }] };
				}

				const data = await response.json();
				return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
			}
		);

		// 2. Search files
		this.server.tool(
			"search_files",
			{
				query: z.string().describe("Search query using Google Drive query syntax"),
				pageSize: z.number().default(20).describe("Number of results to return"),
			},
			async ({ query, pageSize }) => {
				const response = await fetch(
					`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&pageSize=${pageSize}&fields=files(id,name,mimeType,webViewLink,modifiedTime)`,
					{
						headers: { Authorization: `Bearer ${this.props.accessToken}` },
					}
				);

				if (!response.ok) {
					const error = await response.text();
					return { content: [{ type: "text", text: `Error: ${response.status} - ${error}` }] };
				}

				return { content: [{ type: "text", text: JSON.stringify(await response.json(), null, 2) }] };
			}
		);

		// 3. Get file content
		this.server.tool(
			"get_file_content",
			{
				fileId: z.string().describe("The ID of the file to retrieve"),
				mimeType: z
					.string()
					.optional()
					.describe("Export MIME type for Google Docs/Sheets/Slides (e.g., 'text/plain', 'application/pdf')"),
			},
			async ({ fileId, mimeType }) => {
				let url = `https://www.googleapis.com/drive/v3/files/${fileId}`;

				// If mimeType is provided, use export endpoint for Google Workspace files
				if (mimeType) {
					url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(mimeType)}`;
				} else {
					url += "?alt=media";
				}

				const response = await fetch(url, {
					headers: { Authorization: `Bearer ${this.props.accessToken}` },
				});

				if (!response.ok) {
					const error = await response.text();
					return { content: [{ type: "text", text: `Error: ${response.status} - ${error}` }] };
				}

				const content = await response.text();
				return { content: [{ type: "text", text: content }] };
			}
		);

		// 4. Get file metadata
		this.server.tool(
			"get_file_metadata",
			{
				fileId: z.string().describe("The ID of the file"),
			},
			async ({ fileId }) => {
				const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=*`, {
					headers: { Authorization: `Bearer ${this.props.accessToken}` },
				});

				if (!response.ok) {
					const error = await response.text();
					return { content: [{ type: "text", text: `Error: ${response.status} - ${error}` }] };
				}

				return { content: [{ type: "text", text: JSON.stringify(await response.json(), null, 2) }] };
			}
		);

		// 5. Upload file
		this.server.tool(
			"upload_file",
			{
				name: z.string().describe("Name of the file"),
				content: z.string().describe("Content of the file"),
				mimeType: z.string().default("text/plain").describe("MIME type of the file"),
				folderId: z.string().optional().describe("Parent folder ID"),
			},
			async ({ name, content, mimeType, folderId }) => {
				const metadata = {
					name,
					mimeType,
					...(folderId && { parents: [folderId] }),
				};

				const boundary = "-------314159265358979323846";
				const delimiter = `\r\n--${boundary}\r\n`;
				const closeDelimiter = `\r\n--${boundary}--`;

				const multipartRequestBody =
					delimiter +
					"Content-Type: application/json\r\n\r\n" +
					JSON.stringify(metadata) +
					delimiter +
					"Content-Type: " +
					mimeType +
					"\r\n\r\n" +
					content +
					closeDelimiter;

				const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
					method: "POST",
					headers: {
						Authorization: `Bearer ${this.props.accessToken}`,
						"Content-Type": `multipart/related; boundary=${boundary}`,
					},
					body: multipartRequestBody,
				});

				if (!response.ok) {
					const error = await response.text();
					return { content: [{ type: "text", text: `Error: ${response.status} - ${error}` }] };
				}

				return { content: [{ type: "text", text: JSON.stringify(await response.json(), null, 2) }] };
			}
		);

		// 6. Create folder
		this.server.tool(
			"create_folder",
			{
				name: z.string().describe("Name of the folder"),
				parentId: z.string().optional().describe("Parent folder ID"),
			},
			async ({ name, parentId }) => {
				const metadata = {
					name,
					mimeType: "application/vnd.google-apps.folder",
					...(parentId && { parents: [parentId] }),
				};

				const response = await fetch("https://www.googleapis.com/drive/v3/files", {
					method: "POST",
					headers: {
						Authorization: `Bearer ${this.props.accessToken}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(metadata),
				});

				if (!response.ok) {
					const error = await response.text();
					return { content: [{ type: "text", text: `Error: ${response.status} - ${error}` }] };
				}

				return { content: [{ type: "text", text: JSON.stringify(await response.json(), null, 2) }] };
			}
		);

		// 7. Move file
		this.server.tool(
			"move_file",
			{
				fileId: z.string().describe("ID of the file to move"),
				newParentId: z.string().describe("ID of the destination folder"),
				removeParents: z.string().optional().describe("Comma-separated parent IDs to remove"),
			},
			async ({ fileId, newParentId, removeParents }) => {
				let url = `https://www.googleapis.com/drive/v3/files/${fileId}?addParents=${newParentId}`;
				if (removeParents) {
					url += `&removeParents=${removeParents}`;
				}

				const response = await fetch(url, {
					method: "PATCH",
					headers: { Authorization: `Bearer ${this.props.accessToken}` },
				});

				if (!response.ok) {
					const error = await response.text();
					return { content: [{ type: "text", text: `Error: ${response.status} - ${error}` }] };
				}

				return { content: [{ type: "text", text: JSON.stringify(await response.json(), null, 2) }] };
			}
		);

		// 8. Rename file
		this.server.tool(
			"rename_file",
			{
				fileId: z.string().describe("ID of the file to rename"),
				newName: z.string().describe("New name for the file"),
			},
			async ({ fileId, newName }) => {
				const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
					method: "PATCH",
					headers: {
						Authorization: `Bearer ${this.props.accessToken}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ name: newName }),
				});

				if (!response.ok) {
					const error = await response.text();
					return { content: [{ type: "text", text: `Error: ${response.status} - ${error}` }] };
				}

				return { content: [{ type: "text", text: JSON.stringify(await response.json(), null, 2) }] };
			}
		);

		// 9. Delete file
		this.server.tool(
			"delete_file",
			{
				fileId: z.string().describe("ID of the file to delete"),
			},
			async ({ fileId }) => {
				const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
					method: "DELETE",
					headers: { Authorization: `Bearer ${this.props.accessToken}` },
				});

				if (!response.ok) {
					const error = await response.text();
					return { content: [{ type: "text", text: `Error: ${response.status} - ${error}` }] };
				}

				return {
					content: [
						{
							type: "text",
							text: `File ${fileId} deleted successfully`,
						},
					],
				};
			}
		);
	}
}

const oauthProvider = new OAuthProvider({
	// NOTE - during the summer 2025, the SSE protocol was deprecated and replaced by the Streamable-HTTP protocol
	// https://developers.cloudflare.com/agents/model-context-protocol/transport/#mcp-server-with-authentication
	apiHandlers: {
		"/sse": MyMCP.serveSSE("/sse"), // deprecated SSE protocol - use /mcp instead
		"/mcp": MyMCP.serve("/mcp"), // Streamable-HTTP protocol
	},
	authorizeEndpoint: "/authorize",
	clientRegistrationEndpoint: "/register",
	defaultHandler: GoogleHandler as any,
	tokenEndpoint: "/token",
});

// Wrapper to add API Key authentication before OAuth flow
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		// Protect all endpoints except callback (callback needs to be accessible from browser)
		// Only /callback endpoint is excluded because it's accessed directly from user's browser after Google OAuth
		if (url.pathname !== "/callback") {
			const apiKey = request.headers.get("X-API-Key");

			// API Key is required for all MCP connections
			if (!env.ALLOWED_API_KEYS) {
				console.error("ALLOWED_API_KEYS not configured");
				return new Response(
					JSON.stringify({
						error: "Server Configuration Error",
						message: "ALLOWED_API_KEYS environment variable is not configured",
					}),
					{
						status: 500,
						headers: {
							"Content-Type": "application/json",
						},
					}
				);
			}

			const allowedKeys = env.ALLOWED_API_KEYS.split(",").map((k: string) => k.trim());

			console.log("API Key validation:", {
				pathname: url.pathname,
				hasApiKey: !!apiKey,
				apiKeyLength: apiKey?.length,
				allowedKeysCount: allowedKeys.length,
				matches: apiKey ? allowedKeys.includes(apiKey) : false,
			});

			if (!apiKey || !allowedKeys.includes(apiKey)) {
				return new Response(
					JSON.stringify({
						error: "Unauthorized",
						message: "Valid X-API-Key header is required to access this endpoint",
					}),
					{
						status: 401,
						headers: {
							"Content-Type": "application/json",
							"WWW-Authenticate": "X-API-Key",
						},
					}
				);
			}
		}

		// Pass through to OAuth Provider
		return oauthProvider.fetch(request, env, ctx);
	},
};
