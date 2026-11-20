import type { Document } from "@customTypes/document";

export const getGoogleDriveEmbedUrl = (url: string): string | null => {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) return null;
  const fileId = match[1];

  if (url.includes("document")) {
    return `https://docs.google.com/document/d/${fileId}/preview`;
  }
  return `https://drive.google.com/file/d/${fileId}/preview`;
};

export const getDocumentEmbedUrl = (
  externalUrl: string | null | undefined,
  documentType?: Document['document_type'],
  fileUrl?: string | null
): string | null => {
  // 1. Google Drive embed (native rendering for Google Docs, Sheets, Drive-hosted PDFs, etc.)
  if (externalUrl) {
    const googleEmbed = getGoogleDriveEmbedUrl(externalUrl);
    if (googleEmbed) return googleEmbed;
  }

  // 2. External URL iframe (blog posts, RSS entries)
  if (externalUrl && (documentType === 'blog_post' || documentType === 'rss_entry')) {
    return externalUrl;
  }

  // 3. Local file embed (types browsers can render natively in iframes)
  if (fileUrl && (documentType === 'pdf' || documentType === 'txt')) return fileUrl;

  // 4. Office Online Viewer (DOCX and other types that need external rendering)
  if (fileUrl && (documentType === 'docx' || documentType === 'doc')) {
    return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(fileUrl)}`;
  }

  // 5. Content fallback (caller renders document.content when null)
  return null;
};
