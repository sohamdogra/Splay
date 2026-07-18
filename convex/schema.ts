import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  socialMediaFiles: defineTable({
    storageId: v.id("_storage"),
    postId: v.string(),
    contentType: v.string(),
    sourceName: v.string(),
    createdAt: v.number()
  })
    .index("by_storage_id", ["storageId"])
    .index("by_post_id", ["postId"])
});
