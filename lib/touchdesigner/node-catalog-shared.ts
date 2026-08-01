import type { TouchDesignerFamily } from "@/lib/touchdesigner/types";

export const STUDIO_FAMILIES = ["TOP", "CHOP", "POP", "SOP", "DAT", "MAT", "COMP"] as const;
export type StudioFamily = (typeof STUDIO_FAMILIES)[number];

export type NodeCatalogParameter = {
  name: string;
  chineseName: string;
};

export type NodeCatalogEntry = {
  id: string;
  family: StudioFamily;
  operatorType: string;
  englishName: string;
  chineseName: string;
  description: string;
  useCount: number;
  courseCases: string[];
  parameters: NodeCatalogParameter[];
  browserRunnable: boolean;
  source: "COURSE" | "POP_STARTER";
};

export type NodeCatalogResponse = {
  schemaVersion: 1;
  generatedAt: string;
  entries: NodeCatalogEntry[];
  totals: {
    entries: number;
    courseEntries: number;
    families: number;
    browserRunnable: number;
  };
};

export function familyPurpose(family: TouchDesignerFamily) {
  return ({
    TOP: "处理图像、视频和纹理",
    CHOP: "处理声音、动作和连续数值",
    POP: "在 GPU 上处理点、粒子和空间数据",
    SOP: "建立和修改三维几何",
    DAT: "处理表格、文字、脚本和事件",
    MAT: "定义三维表面的材质与光照反应",
    COMP: "组织场景、界面和可复用网络",
    OTHER: "处理其他类型的数据",
  } satisfies Record<TouchDesignerFamily, string>)[family];
}

