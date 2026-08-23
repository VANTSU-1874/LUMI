export type PreviewAttachment = {
  id: "COVER_01" | "COVER_02" | "COVER_03" | "COVER_04" | "COVER_05" | "POSTER_01" | "POSTER_02" | "POSTER_03";
  label: string;
  alt: string;
  url: string;
};

const attachments = {
  COVER_01: {
    id: "COVER_01",
    label: "封面参考 1",
    alt: "黑白文学书籍封面与书脊版式参考",
    url: "/preview-assets/cover-layout/cover-01.webp",
  },
  COVER_02: {
    id: "COVER_02",
    label: "封面参考 2",
    alt: "留白与圆形线条构成的书籍封面参考",
    url: "/preview-assets/cover-layout/cover-02.webp",
  },
  COVER_03: {
    id: "COVER_03",
    label: "封面参考 3",
    alt: "黑白竖向文字与几何块面的书籍封面参考",
    url: "/preview-assets/cover-layout/cover-03.webp",
  },
  COVER_04: {
    id: "COVER_04",
    label: "封面参考 4",
    alt: "黑白红色层级的书籍封面参考",
    url: "/preview-assets/cover-layout/cover-04.webp",
  },
  COVER_05: {
    id: "COVER_05",
    label: "封面参考 5",
    alt: "彩色几何图形与网格构成的书籍封面参考",
    url: "/preview-assets/cover-layout/cover-05.webp",
  },
  POSTER_01: {
    id: "POSTER_01",
    label: "海报素材 1",
    alt: "高饱和拼贴与分区排版海报素材",
    url: "/preview-assets/poster-fusion/poster-01.png",
  },
  POSTER_02: {
    id: "POSTER_02",
    label: "海报素材 2",
    alt: "留白、细字与纵向文字结构的展览海报素材",
    url: "/preview-assets/poster-fusion/poster-02.png",
  },
  POSTER_03: {
    id: "POSTER_03",
    label: "海报素材 3",
    alt: "胶片、票据与生活消费物件构成的海报素材",
    url: "/preview-assets/poster-fusion/poster-03.png",
  },
} as const satisfies Record<string, PreviewAttachment>;

export const coverAttachments = [
  attachments.COVER_01,
  attachments.COVER_02,
  attachments.COVER_03,
  attachments.COVER_04,
  attachments.COVER_05,
] as const;

export const posterFusionAttachments = [
  attachments.POSTER_01,
  attachments.POSTER_02,
  attachments.POSTER_03,
] as const;

export function attachmentForId(id: PreviewAttachment["id"]) {
  return attachments[id];
}
export function coverAttachmentForSession(sessionId?: string) {
  const seed = sessionId ?? "local-preview";
  const value = [...seed].reduce((total, character) => ((total * 31) + character.charCodeAt(0)) >>> 0, 17);
  return coverAttachments[value % coverAttachments.length]!;
}
