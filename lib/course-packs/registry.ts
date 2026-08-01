import { bookDesignCoursePack } from "./book-design";
import { CoursePackSchema, coursePackKey, type CoursePack } from "./contract";
import { digitalInteractionCoursePack } from "./digital-interaction";
import { generalDesignFoundation } from "./general-design";

const packs = [generalDesignFoundation, digitalInteractionCoursePack, bookDesignCoursePack]
  .map((pack) => CoursePackSchema.parse(pack));
const registry = new Map(packs.map((pack) => [coursePackKey(pack), Object.freeze(pack)]));

if (registry.size !== packs.length) throw new Error("course pack keys must be unique");

export const DEFAULT_COURSE_PACK = Object.freeze({ id: "general-design", version: "1" });

export function listCoursePacks(): readonly CoursePack[] {
  return Object.freeze([...registry.values()]);
}

export function getCoursePack(id: string, version: string): CoursePack {
  const pack = registry.get(`${id}@${version}`);
  if (!pack) throw new Error(`unknown course pack: ${id}@${version}`);
  return pack;
}
