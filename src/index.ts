import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { GoogleHandler } from "./google-handler";

// Context from the auth process, encrypted & stored in the auth token
// and provided to the MyMCP as this.props
type Props = {
	name: string;
	email: string;
	accessToken: string;
};

// Google Drive API Permission types
// Using strict discriminated union for type safety
type DrivePermission =
	| {
			type: "user";
			role: "reader" | "writer" | "commenter";
			emailAddress: string;
	  }
	| {
			type: "group";
			role: "reader" | "writer" | "commenter";
			emailAddress: string;
	  }
	| {
			type: "domain";
			role: "reader" | "writer" | "commenter";
			domain: string;
	  }
	| {
			type: "anyone";
			role: "reader" | "writer" | "commenter";
	  };

export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
	server = new McpServer({
		name: "Google Drive MCP",
		version: "1.0.0",
	});

	async init() {
		// Demo tool - keep for testing
		this.server.tool("add", { a: z.number(), b: z.number() }, async ({ a, b }) => ({
			content: [{ text: String(a + b), type: "text" }],
		}));

		// 1. List files in Drive
		this.server.tool(
			"list_files",
			{
				folderId: z.string().optional().describe("Folder ID to list files from. If not provided, lists from root or all accessible files."),
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
			},
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
					},
				);

				if (!response.ok) {
					const error = await response.text();
					return { content: [{ type: "text", text: `Error: ${response.status} - ${error}` }] };
				}

				return { content: [{ type: "text", text: JSON.stringify(await response.json(), null, 2) }] };
			},
		);

		// 3. Get file content
		this.server.tool(
			"get_file_content",
			{
				fileId: z.string().describe("The ID of the file to retrieve"),
				mimeType: z.string().optional().describe("Export MIME type for Google Docs/Sheets/Slides (e.g., 'text/plain', 'application/pdf')"),
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
			},
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
			},
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
				const delimiter = "\r\n--" + boundary + "\r\n";
				const closeDelimiter = "\r\n--" + boundary + "--";

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
			},
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
			},
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
			},
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
			},
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
			},
		);

		// 10. Share file / Set permissions
		// Schema with conditional validation using superRefine
		const shareFileParams = z
			.object({
				fileId: z.string().describe("ID of the file to share"),
				type: z.enum(["user", "group", "domain", "anyone"]).default("user").describe("Permission type"),
				role: z.enum(["reader", "writer", "commenter"]).describe("Permission role"),
				email: z.string().email().optional().describe("Email address (required for 'user' or 'group' type)"),
				domain: z.string().optional().describe("Domain name (required for 'domain' type)"),
			})
			.superRefine((data, ctx) => {
				// Validate conditional requirements based on type
				if (data.type === "user" || data.type === "group") {
					if (!data.email) {
						ctx.addIssue({
							code: z.ZodIssueCode.custom,
							path: ["email"],
							message: `Email is required when type is '${data.type}'`,
						});
					}
				} else if (data.type === "domain") {
					if (!data.domain) {
						ctx.addIssue({
							code: z.ZodIssueCode.custom,
							path: ["domain"],
							message: "Domain is required when type is 'domain'",
						});
					}
				}
			});

		this.server.tool("share_file", shareFileParams.shape, async ({ fileId, email, domain, role, type }) => {
			// Build type-safe permission object using strict discriminated union
			let permission: DrivePermission;

			// Handle each type separately for strict type safety
			if (type === "user") {
				permission = {
					type: "user",
					role,
					emailAddress: email!,  // ! is safe because superRefine validates this
				};
			} else if (type === "group") {
				permission = {
					type: "group",
					role,
					emailAddress: email!,  // ! is safe because superRefine validates this
				};
			} else if (type === "domain") {
				permission = {
					type: "domain",
					role,
					domain: domain!,  // ! is safe because superRefine validates this
				};
			} else {
				// type === "anyone"
				permission = {
					type: "anyone",
					role,
				};
			}

			const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.props.accessToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(permission),
			});

			if (!response.ok) {
				const error = await response.text();
				return { content: [{ type: "text", text: `Error: ${response.status} - ${error}` }] };
			}

			return { content: [{ type: "text", text: JSON.stringify(await response.json(), null, 2) }] };
		});
	}
}

export default new OAuthProvider({
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
