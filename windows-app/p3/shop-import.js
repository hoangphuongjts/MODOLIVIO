"use strict";

// A user-requested import: store only public product fields, not session material.
function storeImportedShopProduct(store, snapshot) {
  if (!snapshot?.ok || !snapshot.title || !snapshot.description ||
      !Array.isArray(snapshot.images) || snapshot.images.length < 4)
    throw new Error("INSUFFICIENT_IMAGES: sản phẩm không có đủ bốn ảnh gốc");
  const safeImages = snapshot.images.filter(u => {
    try { return new URL(u).protocol === "https:"; } catch { return false; }
  }).slice(0,8);
  if (safeImages.length < 4) throw new Error("INSUFFICIENT_IMAGES: thiếu bốn URL ảnh HTTPS");
  const product = store.insert("products", {
    name: String(snapshot.title).slice(0,500),
    description: String(snapshot.description).slice(0,2500),
    benefits: String(snapshot.description).slice(0,2500),
    platform: snapshot.platform, sourceUrl: snapshot.url,
    imageUrls: safeImages, images: safeImages, status: "ready", attentionReason: ""
  });
  return { productId: product.id, ...snapshot, images: safeImages, imageCount: safeImages.length };
}

function recordShopAnnieImport(store, userText, result) {
  const task = store.insert("annieTasks", { title: `Đọc link ${result.platform}: ${result.title}`,
    kind: "read-product", status: "done", productId: result.productId,
    detail: `Đã đọc tên, mô tả và ${result.imageCount} ảnh từ phiên sàn WebContentsView; không lấy cookie.`, seen: 0 });
  const reply = `Annie đã đọc sản phẩm “${result.title}” qua phiên sàn trong MODOLIVIO, lưu ${result.imageCount} ảnh gốc và mô tả vào kho. Anh có thể chọn sản phẩm để tạo video.`;
  store.insert("annieMessages", { role:"user", text:String(userText).slice(0,5000) });
  store.insert("annieMessages", { role:"annie", text:reply });
  return { reply, taskId: task.id, productId: result.productId };
}
module.exports = { storeImportedShopProduct, recordShopAnnieImport };