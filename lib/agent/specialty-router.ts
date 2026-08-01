import { z } from "zod";

import type { StudentDeclaredMajor } from "@/lib/domain/student-onboarding";

import { DesignSpecialtySchema, type AgentView, type DesignSpecialty } from "./contracts";

export { DesignSpecialtySchema, type DesignSpecialty };

export const SpecialtyRouteSchema = z.object({
  specialty: DesignSpecialtySchema,
  label: z.string().min(1).max(80),
  coursePackId: z.enum(["general-design", "digital-interaction", "book-design"]),
  coursePackVersion: z.literal("1"),
  enhanced: z.boolean(),
  reason: z.enum([
    "GENERAL_DEFAULT",
    "MESSAGE_MATCH",
    "INTERFACE_CONTEXT",
    "STUDENT_DECLARED",
  ]),
}).strict();

export type SpecialtyRoute = z.infer<typeof SpecialtyRouteSchema>;

export function routeDesignSpecialty(
  message: string,
  view: AgentView,
  previousCoursePackId?: string,
  declaredMajor?: StudentDeclaredMajor | null,
): SpecialtyRoute {
  const normalized = message.normalize("NFKC");
  const bookMentioned = /(书籍设计|版式设计|书籍|手工书|装帧|经折装|折页书|导览册|页序|书封|书籍封面|册页|开本)/i.test(normalized);
  const digitalMentioned = /(数字交互(?:文创)?|touchdesigner|digishow|\.toe\b|\bosc\b|节点|音频驱动|声音驱动|粒子|信号链|互动作品|互动装置|交互装置|体感交互|传感器|输入.{0,12}(映射|输出)|映射.{0,12}输出|chop\b|top\b|sop\b|dat\b|comp\b|声音.{0,12}(画面|视觉|图像)|画面.{0,12}(不动|没变化|没反应)|数值.{0,12}(画面|视觉|图像))/i.test(normalized);
  const generalSpecialtyMentioned = /(海报|包装|品牌|ui\b|ux\b|用户体验|产品设计|工业设计|空间设计|展陈|室内|景观|服装|面料|首饰|珠宝|影像|视频|短片|镜头|动画|工艺|陶瓷|插画|摄影|字体|广告|服务设计|ip形象|角色设计)/i.test(normalized);

  if (digitalMentioned) return SpecialtyRouteSchema.parse({
    specialty: "DIGITAL_INTERACTION",
    label: "数字交互专业增强",
    coursePackId: "digital-interaction",
    coursePackVersion: "1",
    enhanced: true,
    reason: "MESSAGE_MATCH",
  });
  if (bookMentioned) return SpecialtyRouteSchema.parse({
    specialty: "BOOK_DESIGN",
    label: "书籍设计专业增强",
    coursePackId: "book-design",
    coursePackVersion: "1",
    enhanced: true,
    reason: "MESSAGE_MATCH",
  });
  if (generalSpecialtyMentioned) return SpecialtyRouteSchema.parse({
    specialty: "GENERAL_DESIGN",
    label: "通用设计",
    coursePackId: "general-design",
    coursePackVersion: "1",
    enhanced: false,
    reason: "MESSAGE_MATCH",
  });
  if (view === "BOOK_LAYOUT_LAB") return SpecialtyRouteSchema.parse({
    specialty: "BOOK_DESIGN",
    label: "书籍设计专业增强",
    coursePackId: "book-design",
    coursePackVersion: "1",
    enhanced: true,
    reason: "INTERFACE_CONTEXT",
  });
  if (view === "NODE_CANVAS") return SpecialtyRouteSchema.parse({
    specialty: "DIGITAL_INTERACTION",
    label: "数字交互专业增强",
    coursePackId: "digital-interaction",
    coursePackVersion: "1",
    enhanced: true,
    reason: "INTERFACE_CONTEXT",
  });
  if (previousCoursePackId === "digital-interaction") return SpecialtyRouteSchema.parse({
    specialty: "DIGITAL_INTERACTION",
    label: "数字交互专业增强",
    coursePackId: "digital-interaction",
    coursePackVersion: "1",
    enhanced: true,
    reason: "INTERFACE_CONTEXT",
  });
  if (previousCoursePackId === "book-design") return SpecialtyRouteSchema.parse({
    specialty: "BOOK_DESIGN",
    label: "书籍设计专业增强",
    coursePackId: "book-design",
    coursePackVersion: "1",
    enhanced: true,
    reason: "INTERFACE_CONTEXT",
  });
  if (previousCoursePackId === "general-design") return SpecialtyRouteSchema.parse({
    specialty: "GENERAL_DESIGN",
    label: "通用设计",
    coursePackId: "general-design",
    coursePackVersion: "1",
    enhanced: false,
    reason: "INTERFACE_CONTEXT",
  });
  if (declaredMajor === "digital-interaction") return SpecialtyRouteSchema.parse({
    specialty: "DIGITAL_INTERACTION",
    label: "数字交互专业增强",
    coursePackId: "digital-interaction",
    coursePackVersion: "1",
    enhanced: true,
    reason: "STUDENT_DECLARED",
  });
  if (declaredMajor === "book-design") return SpecialtyRouteSchema.parse({
    specialty: "BOOK_DESIGN",
    label: "书籍设计专业增强",
    coursePackId: "book-design",
    coursePackVersion: "1",
    enhanced: true,
    reason: "STUDENT_DECLARED",
  });
  if (declaredMajor === "general-design") return SpecialtyRouteSchema.parse({
    specialty: "GENERAL_DESIGN",
    label: "通用设计",
    coursePackId: "general-design",
    coursePackVersion: "1",
    enhanced: false,
    reason: "STUDENT_DECLARED",
  });
  return SpecialtyRouteSchema.parse({
    specialty: "GENERAL_DESIGN",
    label: "通用设计",
    coursePackId: "general-design",
    coursePackVersion: "1",
    enhanced: false,
    reason: "GENERAL_DEFAULT",
  });
}
