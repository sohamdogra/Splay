import { mutationGeneric } from "convex/server";
import { v } from "convex/values";

export const generateUploadUrl = mutationGeneric({
  args: {
    ingestToken: v.string()
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    requireIngestToken(args.ingestToken);
    return await ctx.storage.generateUploadUrl();
  }
});

export const finalizeUpload = mutationGeneric({
  args: {
    ingestToken: v.string(),
    storageId: v.id("_storage"),
    postId: v.string(),
    contentType: v.string(),
    sourceName: v.string()
  },
  returns: v.object({
    storageId: v.id("_storage"),
    url: v.string()
  }),
  handler: async (ctx, args) => {
    requireIngestToken(args.ingestToken);
    if (!args.contentType.startsWith("image/")) throw new Error("Only image uploads are accepted.");
    if (!args.postId.trim() || args.postId.length > 300) throw new Error("Invalid post ID.");
    if (!args.sourceName.trim() || args.sourceName.length > 500) throw new Error("Invalid source name.");

    const storedFile = await ctx.db.system.get(args.storageId);
    if (!storedFile) throw new Error("Uploaded file was not found in Convex storage.");
    if (storedFile.contentType && storedFile.contentType !== args.contentType) {
      throw new Error("Uploaded file content type does not match the finalized media record.");
    }

    const existing = await ctx.db
      .query("socialMediaFiles")
      .withIndex("by_storage_id", (query) => query.eq("storageId", args.storageId))
      .unique();
    if (!existing) {
      await ctx.db.insert("socialMediaFiles", {
        storageId: args.storageId,
        postId: args.postId,
        contentType: args.contentType,
        sourceName: args.sourceName,
        createdAt: Date.now()
      });
    }

    const url = await ctx.storage.getUrl(args.storageId);
    if (!url) throw new Error("Convex did not return a public URL for the uploaded file.");
    return { storageId: args.storageId, url };
  }
});

function requireIngestToken(supplied: string): void {
  const expected = process.env.CONVEX_INGEST_TOKEN;
  if (!expected) throw new Error("CONVEX_INGEST_TOKEN is not configured on the Convex deployment.");
  if (supplied !== expected) throw new Error("Unauthorized media ingest request.");
}
