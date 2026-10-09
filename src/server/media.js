import { withRepository, ContentError } from "./repository.js";

function sameUploadedMedia(existing, media) {
  return existing && ["mime", "size", "originalName"].every((field) => existing[field] === media[field]) &&
    ["provider", "bucket", "key"].every((field) => existing.storage?.[field] === media.storage[field]);
}

export async function prepareBrowserUpload(body, options) {
  return withRepository((repository) => repository.createBrowserUpload(body), options);
}

export async function completeBrowserUpload(body, options) {
  return withRepository(async (repository) => {
    const plan = await repository.verifyBrowserUpload(body?.uploadToken);
    const media = { name: plan.name, mime: plan.mime, size: plan.size, originalName: plan.originalName, storage: plan.storage };
    const existing = await repository.getMedia(plan.name);
    if (existing && !sameUploadedMedia(existing, media)) {
      throw new ContentError("素材已登记且与上传确认信息不一致", 409);
    }
    const access = await repository.createMediaUrl(plan.name, "GET", plan.storage);
    const mediaUrl = await repository.getMediaReference(plan.name, plan.storage);
    if (!existing) {
      try {
        const actual = await repository.inspectUploadedObject({ key: plan.key, kind: plan.kind, mime: plan.mime, size: plan.size });
        await repository.promoteUploadedObject({ sourceKey: plan.key, name: plan.name, etag: actual.etag });
        // Atomic registration accepts concurrent confirmations of identical media.
        // Failure leaves uploaded objects available for confirmation retries.
        await repository.confirmMedia(media);
      } catch (error) {
        // Another confirmation may finish and remove the temporary source meanwhile.
        if (!sameUploadedMedia(await repository.getMedia(plan.name), media)) throw error;
      }
    }
    await repository.removeUploadedObject(plan.key).catch(() => {});
    return { ...access, mediaUrl, name: plan.originalName, size: plan.size, kind: plan.kind };
  }, options);
}
export async function mediaAccess(request, body, options) {
  if (!body || typeof body.url !== "string" || body.url.length > 2048 ||
      body.download !== undefined) throw new ContentError("素材访问参数无效");
  return withRepository(async (repository) => {
    const media = await repository.resolveMediaReference(body.url);
    if (!media?.storage) throw new ContentError("OSS 素材不存在或未登记", 404);
    const access = await repository.createMediaUrl(media.name);
    const mediaUrl = await repository.getMediaReference(media.name, media.storage);
    return Response.json({ ...access, mediaUrl }, {
      headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  }, options);
}
